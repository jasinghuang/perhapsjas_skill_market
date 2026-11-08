import json
from pathlib import Path
from unittest.mock import MagicMock, patch
import pytest
from mux import (
    VideoInfo,
    mux_video,
    needs_reencode,
    probe_audio_duration,
    probe_video,
    verify_output,
)


def _probe_payload(codec_name="h264", duration="10.0"):
    return {"streams": [{"codec_name": codec_name, "width": 1920,
                         "height": 1080, "r_frame_rate": "30/1",
                         "duration": duration}]}


def _streams_payload(*streams):
    return {"streams": list(streams)}


def test_probe_video_parses_ffprobe_json():
    payload = {"streams": [{"codec_name": "h264", "width": 1920, "height": 1080,
                            "r_frame_rate": "30/1", "duration": "12.5"}]}
    with patch("subprocess.run") as run:
        run.return_value = MagicMock(returncode=0, stdout=json.dumps(payload))
        info = probe_video(Path("in.mp4"))
    assert info == VideoInfo(12.5, "h264", 1920, 1080, "30/1")


def test_probe_video_falls_back_to_format_duration():
    # Typical Matroska/WebM: stream has no duration, container format does.
    payload = {
        "streams": [{"codec_name": "vp9", "width": 1920, "height": 1080,
                     "r_frame_rate": "30/1"}],
        "format": {"duration": "7.5"},
    }
    with patch("subprocess.run") as run:
        run.return_value = MagicMock(returncode=0, stdout=json.dumps(payload))
        info = probe_video(Path("in.webm"))
    assert info == VideoInfo(7.5, "vp9", 1920, 1080, "30/1")


def test_probe_video_selects_first_video_stream_and_requests_format_duration():
    payload = {"streams": [{"codec_name": "h264", "width": 1920, "height": 1080,
                            "r_frame_rate": "30/1", "duration": "12.5"}]}
    with patch("subprocess.run") as run:
        run.return_value = MagicMock(returncode=0, stdout=json.dumps(payload))
        probe_video(Path("in.mp4"))
    cmd = run.call_args.args[0]
    assert cmd[0] == "ffprobe"
    assert cmd[cmd.index("-select_streams") + 1] == "v:0"
    assert "format=duration" in cmd[cmd.index("-show_entries") + 1]


def test_probe_video_rejects_missing_video_stream():
    payload = {"streams": [], "format": {"duration": "10.0"}}
    with patch("subprocess.run") as run:
        run.return_value = MagicMock(returncode=0, stdout=json.dumps(payload))
        with pytest.raises(RuntimeError, match="no video stream"):
            probe_video(Path("in.mp4"))


def test_probe_video_raises_with_ffprobe_stderr():
    with patch("subprocess.run") as run:
        run.return_value = MagicMock(returncode=1, stderr="boom")
        with pytest.raises(RuntimeError, match="boom"):
            probe_video(Path("in.mp4"))


def test_probe_audio_duration_parses_format():
    payload = {"format": {"duration": "12.5"}}
    with patch("subprocess.run") as run:
        run.return_value = MagicMock(returncode=0, stdout=json.dumps(payload))
        assert probe_audio_duration(Path("a.wav")) == 12.5


def test_needs_reencode():
    assert not needs_reencode("h264")
    assert not needs_reencode("hevc")
    assert needs_reencode("vp9")
    assert needs_reencode("av1")


# --- mux：临时文件 + 原子替换 ------------------------------------------------


def test_mux_failure_keeps_existing_output_and_leaves_no_tmp(tmp_path):
    out = tmp_path / "out.mp4"
    out.write_bytes(b"previous")
    with patch("subprocess.run") as run, patch("mux.verify_output") as verify:
        run.side_effect = [
            MagicMock(returncode=0, stdout=json.dumps(_probe_payload())),
            MagicMock(returncode=0),  # ffmpeg “成功”
        ]
        verify.side_effect = RuntimeError("bad")
        with pytest.raises(RuntimeError):
            mux_video(tmp_path / "in.mp4", tmp_path / "t.wav", out, "h264")
    assert out.read_bytes() == b"previous"      # 校验失败不覆盖已有成品
    assert list(tmp_path.glob(".out.mp4.*")) == []  # 临时文件已清理


def test_mux_ffmpeg_failure_raises_and_cleans_tmp(tmp_path):
    out = tmp_path / "out.mp4"
    with patch("subprocess.run") as run:
        run.side_effect = [
            MagicMock(returncode=0, stdout=json.dumps(_probe_payload())),
            MagicMock(returncode=1, stderr="ffmpeg boom"),
        ]
        with pytest.raises(RuntimeError, match="ffmpeg boom"):
            mux_video(tmp_path / "in.mp4", tmp_path / "t.wav", out, "h264")
    assert list(tmp_path.glob(".out.mp4.*")) == []


def test_mux_success_replaces_atomically_at_master_rate(tmp_path):
    out = tmp_path / "out.mp4"
    replaced = {}

    def fake_replace(src, dst):
        replaced["src"], replaced["dst"] = src, dst

    with patch("subprocess.run") as run, \
         patch("mux.verify_output", return_value=None) as verify, \
         patch("mux.os.replace", side_effect=fake_replace):
        run.side_effect = [
            MagicMock(returncode=0, stdout=json.dumps(_probe_payload())),
            MagicMock(returncode=0),
        ]
        mux_video(tmp_path / "in.mp4", tmp_path / "t.wav", out, "h264",
                  sample_rate=48000)
    # 校验发生在临时文件上；成功后才原子替换到最终路径。
    assert str(verify.call_args.args[0]).startswith(str(tmp_path / ".out.mp4."))
    assert replaced["dst"] == out
    cmd = [c.args[0] for c in run.call_args_list if c.args[0][0] == "ffmpeg"][0]
    assert cmd[cmd.index("-ar") + 1] == "48000"  # AAC 显式采用音轨采样率
    assert cmd[cmd.index("-c:a") + 1] == "aac"
    assert cmd[cmd.index("-c:v") + 1] == "copy"
    assert "-shortest" not in cmd


def test_mux_reencode_command_shape(tmp_path):
    replaced = {}
    with patch("subprocess.run") as run, \
         patch("mux.verify_output", return_value=None), \
         patch("mux.os.replace", side_effect=lambda s, d: replaced.update(src=s, dst=d)):
        run.side_effect = [
            MagicMock(returncode=0, stdout=json.dumps(_probe_payload("vp9"))),
            MagicMock(returncode=0),
        ]
        mux_video(tmp_path / "in.webm", tmp_path / "t.wav", tmp_path / "out.mp4",
                  "vp9")
    cmd = [c.args[0] for c in run.call_args_list if c.args[0][0] == "ffmpeg"][0]
    assert cmd[cmd.index("-c:v") + 1] == "libx264"
    assert cmd[cmd.index("-crf") + 1] == "18"
    assert cmd[cmd.index("-preset") + 1] == "medium"
    assert cmd[cmd.index("-movflags") + 1] == "+faststart"
    assert [cmd[i + 1] for i, arg in enumerate(cmd) if arg == "-map"] == \
        ["0:v:0", "1:a:0"]
    assert "-shortest" not in cmd


def test_mux_warns_when_reencoding(tmp_path, capsys):
    with patch("subprocess.run") as run, \
         patch("mux.verify_output"), \
         patch("mux.os.replace"):
        run.side_effect = [
            MagicMock(returncode=0, stdout=json.dumps(_probe_payload("vp9"))),
            MagicMock(returncode=0),
        ]
        mux_video(tmp_path / "in.webm", tmp_path / "t.wav", tmp_path / "out.mp4",
                  "vp9")
    assert "重编码" in capsys.readouterr().err


def test_mux_does_not_warn_when_copying(tmp_path, capsys):
    with patch("subprocess.run") as run, \
         patch("mux.verify_output"), \
         patch("mux.os.replace"):
        run.side_effect = [
            MagicMock(returncode=0, stdout=json.dumps(_probe_payload())),
            MagicMock(returncode=0),
        ]
        mux_video(tmp_path / "in.mp4", tmp_path / "t.wav", tmp_path / "out.mp4",
                  "h264")
    assert "重编码" not in capsys.readouterr().err


# --- verify：视频与音频双时长校验 -------------------------------------------


def test_verify_rejects_missing_audio_or_duration_drift(tmp_path):
    payload = {"streams": [{"codec_type": "video", "duration": "10.0"}]}
    with patch("subprocess.run") as run:
        run.return_value = MagicMock(returncode=0, stdout=json.dumps(payload))
        with pytest.raises(RuntimeError):
            verify_output(tmp_path / "out.mp4", 10.0)


def test_verify_accepts_one_video_and_one_audio_within_tolerance(tmp_path):
    payload = _streams_payload(
        {"codec_type": "video", "duration": "10.05"},
        {"codec_type": "audio", "codec_name": "aac", "duration": "10.0"},
    )
    with patch("subprocess.run") as run:
        run.return_value = MagicMock(returncode=0, stdout=json.dumps(payload))
        verify_output(tmp_path / "out.mp4", 10.0)


def test_verify_rejects_video_duration_drift(tmp_path):
    payload = _streams_payload(
        {"codec_type": "video", "duration": "11.0"},
        {"codec_type": "audio", "codec_name": "aac", "duration": "10.0"},
    )
    with patch("subprocess.run") as run:
        run.return_value = MagicMock(returncode=0, stdout=json.dumps(payload))
        with pytest.raises(RuntimeError, match="video duration"):
            verify_output(tmp_path / "out.mp4", 10.0)


def test_verify_rejects_audio_duration_drift(tmp_path):
    # 只验视频时长会漏掉「末段音频缺失」；音频流时长单独校验。
    payload = _streams_payload(
        {"codec_type": "video", "duration": "10.0"},
        {"codec_type": "audio", "codec_name": "aac", "duration": "8.0"},
    )
    with patch("subprocess.run") as run:
        run.return_value = MagicMock(returncode=0, stdout=json.dumps(payload))
        with pytest.raises(RuntimeError, match="audio duration"):
            verify_output(tmp_path / "out.mp4", 10.0)


def test_verify_rejects_extra_video_stream(tmp_path):
    payload = _streams_payload(
        {"codec_type": "video", "duration": "10.0"},
        {"codec_type": "video", "duration": "10.0"},
        {"codec_type": "audio", "codec_name": "aac", "duration": "10.0"},
    )
    with patch("subprocess.run") as run:
        run.return_value = MagicMock(returncode=0, stdout=json.dumps(payload))
        with pytest.raises(RuntimeError, match="one video stream"):
            verify_output(tmp_path / "out.mp4", 10.0)


def test_verify_rejects_extra_audio_stream(tmp_path):
    payload = _streams_payload(
        {"codec_type": "video", "duration": "10.0"},
        {"codec_type": "audio", "codec_name": "aac", "duration": "10.0"},
        {"codec_type": "audio", "codec_name": "aac", "duration": "10.0"},
    )
    with patch("subprocess.run") as run:
        run.return_value = MagicMock(returncode=0, stdout=json.dumps(payload))
        with pytest.raises(RuntimeError, match="one audio stream"):
            verify_output(tmp_path / "out.mp4", 10.0)


def test_verify_rejects_non_aac_audio(tmp_path):
    payload = _streams_payload(
        {"codec_type": "video", "duration": "10.0"},
        {"codec_type": "audio", "codec_name": "opus", "duration": "10.0"},
    )
    with patch("subprocess.run") as run:
        run.return_value = MagicMock(returncode=0, stdout=json.dumps(payload))
        with pytest.raises(RuntimeError, match="AAC"):
                    verify_output(tmp_path / "out.mp4", 10.0)


def test_verify_falls_back_to_format_duration(tmp_path):
    payload = {
        "streams": [
            {"codec_type": "video"},
            {"codec_type": "audio", "codec_name": "aac", "duration": "10.0"},
        ],
        "format": {"duration": "10.1"},
    }
    with patch("subprocess.run") as run:
        run.return_value = MagicMock(returncode=0, stdout=json.dumps(payload))
        verify_output(tmp_path / "out.mp4", 10.0)
