import concurrent.futures
import json
from pathlib import Path

import pytest
import media
import skill_main
from delivery import content_key, markdown, publish
from job_cache import job_directory
from results import build_result, make_word
from subtitles import attach_punctuation, build_entries, entries_to_srt, finalize_entries, parse_srt, validate_srt


def test_single_oversized_unit_is_complete_single_line():
    text = 'a' * 104 + '中文' * 35
    entries = finalize_entries(build_entries([make_word(0, 3, text)]), 4)[0]
    result = parse_srt(entries_to_srt(entries))
    assert result[0][3] == text and '\n' not in result[0][3]


def test_quote_hyphen_punctuation_survive_and_english_period_splits():
    raw = '“Well-known AI.” Next sentence!'
    words = [make_word(i, i + .5, x) for i, x in enumerate(['Wellknown', 'AI', 'Next', 'sentence'])]
    entries = build_entries(attach_punctuation(words, raw))
    assert len(entries) == 2
    assert entries[0]['text'] == '“Well-known AI.”'
    assert content_key(''.join(e['text'] for e in entries)) == content_key(raw)


def test_balanced_cut_avoids_hanging_of():
    raw = 'started a trend with hundreds of recreations,'
    words = [make_word(i*.25, (i+1)*.25, x) for i,x in enumerate(raw.split())]
    entries = build_entries(words)
    assert all(not e['text'].endswith('of') for e in entries)
    assert content_key(''.join(e['text'] for e in entries)) == content_key(raw)


def test_severe_overlap_fails_without_dropping():
    with pytest.raises(ValueError, match='Severe'):
        finalize_entries([{'start':0,'end':5,'text':'one'}, {'start':1,'end':6,'text':'two'}], 10)


def test_publish_numbers_existing_group_and_preserves_bytes(tmp_path):
    original = tmp_path/'sample.srt'; original.write_bytes(b'keep me')
    (tmp_path/'sample_2.md').write_text('older other format')
    paths = publish(tmp_path, 'sample', {'srt':'new subtitle', 'md':'new prose'})
    assert paths['srt'].name == 'sample_3.srt'
    assert paths['md'].name == 'sample_3.md'
    assert original.read_bytes() == b'keep me'
    assert not list(tmp_path.glob('.transcribe-*'))


def test_concurrent_publish_never_clobbers(tmp_path):
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda i: publish(tmp_path, 'same', {'srt':str(i)}), range(8)))
    assert len({r['srt'] for r in results}) == 8
    assert sorted(p.read_text() for p in tmp_path.glob('*.srt')) == list(map(str, range(8)))


def test_publication_io_failure_rolls_back_only_own_products(tmp_path, monkeypatch):
    import delivery
    real_link = delivery.os.link
    calls = []
    def link(a,b):
        calls.append(b)
        if len(calls) == 2: raise OSError('disk error')
        return real_link(a,b)
    monkeypatch.setattr(delivery.os, 'link', link)
    with pytest.raises(OSError): publish(tmp_path/'out', 'sample', {'srt':'one','md':'two'})
    assert list((tmp_path/'out').iterdir()) == []


def test_markdown_formats_preserve_paragraphs_and_sentence_spacing():
    result = {'text':'Hello. Next sentence. New topic.', 'segments':[
        {'start':0,'end':1,'text':'Hello.'}, {'start':1.1,'end':2,'text':'Next sentence.'},
        {'start':5,'end':6,'text':'New topic.'}]}
    plain = markdown(result); timed = markdown(result, timed=True)
    assert plain == 'Hello. Next sentence.\n\nNew topic.\n'
    assert '00:00:00,000 --> 00:00:02,000' in timed
    assert '00:00:05,000 --> 00:00:06,000' in timed
    assert '-->' not in plain


def test_cache_changes_with_content_and_track_even_if_stat_unchanged(tmp_path):
    class Backend:
        provider='qwen'; backend='test'; model_id='model'
    p=tmp_path/'a.wav'; p.write_bytes(b'abcd')
    import os
    stat=p.stat()
    first=job_directory(p, Backend(), 'en', {'audio_track':0})
    other=job_directory(p, Backend(), 'en', {'audio_track':1})
    p.write_bytes(b'efgh'); os.utime(p, ns=(stat.st_atime_ns,stat.st_mtime_ns))
    changed=job_directory(p, Backend(), 'en', {'audio_track':0})
    assert len({first,other,changed}) == 3
    assert not any(tmp_path.glob('.*chunks*'))


def test_default_srt_and_cache_export_without_extra_files(tmp_path, monkeypatch):
    class Backend:
        provider='qwen'; backend='test'; model_id='test-model'; calls=0
        def probe(self): return {'status':'ready','checks':[]}
        def transcribe(self,*args,**kwargs):
            self.calls += 1
            return build_result(provider=self.provider, backend=self.backend, model_id=self.model_id,
                language='en', duration=3, text='Hello, world.',
                words=[make_word(.5,1,'Hello'), make_word(1.1,2,'world')])
    p=tmp_path/'video.wav'; p.write_bytes(b'fake media')
    monkeypatch.setattr(media,'probe_media',lambda p:{'duration':3,'audio_streams':[{'index':1}]})
    backend=Backend(); dest=tmp_path/'out'
    first=skill_main.transcribe_one(backend,p,dest,['srt'],'en',{},False)
    second=skill_main.transcribe_one(backend,p,dest,['srt'],'en',{},False)
    assert backend.calls == 1
    assert first['status'] == second['status'] == 'complete'
    assert {p.name for p in dest.iterdir()} == {'video.srt','video_2.srt'}
    assert validate_srt((dest/'video.srt').read_text(),3) == []
    assert not list(tmp_path.glob('.*chunks*'))


def test_incomplete_alignment_does_not_publish_requested_srt(tmp_path, monkeypatch):
    class Backend:
        provider='qwen';backend='test';model_id='test'
        def probe(self): return {'status':'ready','checks':[]}
        def transcribe(self,*a,**kw):
            return build_result(provider='qwen',backend='test',model_id='test',language='en',duration=3,
                text='Hello missing words',words=[make_word(0,1,'Hello')])
    p=tmp_path/'a.wav';p.write_bytes(b'x')
    monkeypatch.setattr(media,'probe_media',lambda p:{'duration':3,'audio_streams':[{'index':0}]})
    r=skill_main.transcribe_one(Backend(),p,tmp_path/'out',['srt'],'en',{},False)
    assert r['status']=='partial' and r['products']=={}


def test_concurrent_different_formats_get_distinct_groups(tmp_path):
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda kind: publish(tmp_path/'out', 'same', {kind:kind}), ['srt','md']))
    assert {next(iter(r.values())).stem for r in results} == {'same','same_2'}


def test_plain_md_without_alignment_still_paragraphs_long_text():
    raw = 'A faithful sentence. ' * 60
    result = markdown({'text':raw,'segments':[]})
    assert result.count('\n\n') >= 2
    assert content_key(result) == content_key(raw)


def test_nonfinite_time_cannot_be_published():
    with pytest.raises(ValueError):
        build_entries([make_word(float('nan'), 2, 'hello')])
