import json
from pathlib import Path
from unittest.mock import MagicMock, patch
import pytest
from mux import VideoInfo, mux_video, needs_reencode, probe_video, verify_output


def test_probe_video_parses_ffprobe_json():
    payload = {"streams": [{"codec_name": "h264", "width": 1920, "height": 1080,
                            "r_frame_rate": "30/1", "duration": "12.5"}]}
    with patch("subprocess.run") as run:
        run.return_value = MagicMock(returncode=0, stdout=json.dumps(payload))
        info = probe_video(Path("in.mp4"))
    assert info == VideoInfo(12.5, "h264", 1920, 1080, "30/1")


def test_needs_reencode():
    assert not needs_reencode("h264")
    assert not needs_reencode("hevc")
    assert needs_reencode("vp9")
    assert needs_reencode("av1")


def test_mux_copy_command_and_delete_on_failure(tmp_path):
    out = tmp_path / "out.mp4"
    with patch("subprocess.run") as run, patch.object(Path, "unlink") as unlink:
        run.side_effect = [MagicMock(returncode=0), MagicMock(returncode=1)]
        with patch("mux.verify_output", side_effect=RuntimeError("bad")):
            with pytest.raises(RuntimeError):
                mux_video(tmp_path / "in.mp4", tmp_path / "t.wav", out, "h264")
        unlink.assert_called_once()


def test_verify_rejects_missing_audio_or_duration_drift(tmp_path):
    payload = {"streams": [{"codec_type": "video", "duration": "10.0"}]}
    with patch("subprocess.run") as run:
        run.return_value = MagicMock(returncode=0, stdout=json.dumps(payload))
        with pytest.raises(RuntimeError):
            verify_output(tmp_path / "out.mp4", 10.0)


# --- supplementary coverage: failure messages, tolerance, and command shape ---


def test_probe_video_raises_with_ffprobe_stderr():
    with patch("subprocess.run") as run:
        run.return_value = MagicMock(returncode=1, stderr="boom")
        with pytest.raises(RuntimeError, match="boom"):
            probe_video(Path("in.mp4"))


def test_verify_accepts_one_video_and_one_audio_within_tolerance(tmp_path):
    payload = {"streams": [
        {"codec_type": "video", "duration": "10.05"},
        {"codec_type": "audio", "duration": "10.0"},
    ]}
    with patch("subprocess.run") as run:
        run.return_value = MagicMock(returncode=0, stdout=json.dumps(payload))
        verify_output(tmp_path / "out.mp4", 10.0)


def test_verify_rejects_duration_drift(tmp_path):
    payload = {"streams": [
        {"codec_type": "video", "duration": "11.0"},
        {"codec_type": "audio", "duration": "11.0"},
    ]}
    with patch("subprocess.run") as run:
        run.return_value = MagicMock(returncode=0, stdout=json.dumps(payload))
        with pytest.raises(RuntimeError, match="duration"):
            verify_output(tmp_path / "out.mp4", 10.0)


def test_mux_copy_command_shape(tmp_path):
    out = tmp_path / "out.mp4"
    probe_payload = {"streams": [{"codec_name": "h264", "width": 1920,
                                  "height": 1080, "r_frame_rate": "30/1",
                                  "duration": "10.0"}]}
    with patch("subprocess.run") as run, patch("mux.verify_output") as verify:
        run.side_effect = [
            MagicMock(returncode=0),
            MagicMock(returncode=0, stdout=json.dumps(probe_payload)),
        ]
        mux_video(tmp_path / "in.mp4", tmp_path / "t.wav", out, "h264")
    cmd = run.call_args_list[0].args[0]
    assert cmd[cmd.index("-c:v") + 1] == "copy"
    assert cmd[cmd.index("-c:a") + 1] == "aac"
    assert cmd[cmd.index("-b:a") + 1] == "192k"
    assert cmd[cmd.index("-movflags") + 1] == "+faststart"
    assert "-shortest" not in cmd
    verify.assert_called_once_with(out, 10.0)


def test_mux_reencode_command_shape(tmp_path):
    out = tmp_path / "out.mp4"
    probe_payload = {"streams": [{"codec_name": "vp9", "width": 1920,
                                  "height": 1080, "r_frame_rate": "30/1",
                                  "duration": "10.0"}]}
    with patch("subprocess.run") as run, patch("mux.verify_output") as verify:
        run.side_effect = [
            MagicMock(returncode=0),
            MagicMock(returncode=0, stdout=json.dumps(probe_payload)),
        ]
        mux_video(tmp_path / "in.webm", tmp_path / "t.wav", out, "vp9")
    cmd = run.call_args_list[0].args[0]
    assert cmd[cmd.index("-c:v") + 1] == "libx264"
    assert cmd[cmd.index("-crf") + 1] == "18"
    assert cmd[cmd.index("-preset") + 1] == "medium"
    assert "-shortest" not in cmd
    verify.assert_called_once_with(out, 10.0)


def test_probe_video_selects_first_video_stream():
    payload = {"streams": [{"codec_name": "h264", "width": 1920, "height": 1080,
                            "r_frame_rate": "30/1", "duration": "12.5"}]}
    with patch("subprocess.run") as run:
        run.return_value = MagicMock(returncode=0, stdout=json.dumps(payload))
        probe_video(Path("in.mp4"))
    cmd = run.call_args.args[0]
    assert cmd[0] == "ffprobe"
    assert cmd[cmd.index("-select_streams") + 1] == "v:0"


def _probe_payload(duration="10.0"):
    return {"streams": [{"codec_name": "h264", "width": 1920, "height": 1080,
                         "r_frame_rate": "30/1", "duration": duration}]}


def test_mux_deletes_output_when_ffmpeg_fails(tmp_path):
    out = tmp_path / "out.mp4"
    with patch("subprocess.run") as run, patch.object(Path, "unlink") as unlink:
        run.return_value = MagicMock(returncode=1, stderr="ffmpeg boom")
        with patch("mux.verify_output") as verify:
            with pytest.raises(RuntimeError, match="ffmpeg boom"):
                mux_video(tmp_path / "in.mp4", tmp_path / "t.wav", out, "h264")
        unlink.assert_called_once()
        verify.assert_not_called()


def test_mux_deletes_output_when_verify_fails(tmp_path):
    out = tmp_path / "out.mp4"
    with patch("subprocess.run") as run, patch.object(Path, "unlink") as unlink:
        run.side_effect = [
            MagicMock(returncode=0),
            MagicMock(returncode=0, stdout=json.dumps(_probe_payload())),
        ]
        with patch("mux.verify_output", side_effect=RuntimeError("bad")):
            with pytest.raises(RuntimeError, match="bad"):
                mux_video(tmp_path / "in.mp4", tmp_path / "t.wav", out, "h264")
        unlink.assert_called_once()
