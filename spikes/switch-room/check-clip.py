#!/usr/bin/env python3
"""Decode the prototype clip, then prove that muted and video-only twins fail."""

import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np


def verify(path):
    metadata = json.loads(
        subprocess.check_output(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_streams",
                "-show_format",
                "-of",
                "json",
                str(path),
            ]
        )
    )
    video = next(s for s in metadata["streams"] if s["codec_type"] == "video")
    audio = next((s for s in metadata["streams"] if s["codec_type"] == "audio"), None)
    if audio is None or audio["channels"] != 2 or audio["sample_rate"] != "48000":
        raise ValueError("Missing 48 kHz stereo audio")
    if abs(float(video["start_time"]) - float(audio["start_time"])) > 0.05:
        raise ValueError("Different audio and video starts")
    if not 29 <= float(metadata["format"]["duration"]) <= 32:
        raise ValueError("Expected a full 30-second clip")
    raw = subprocess.check_output(
        [
            "ffmpeg",
            "-v",
            "error",
            "-i",
            str(path),
            "-map",
            "0:a:0",
            "-t",
            "3",
            "-f",
            "s16le",
            "-ar",
            "48000",
            "-ac",
            "2",
            "pipe:1",
        ]
    )
    samples = np.frombuffer(raw, dtype="<i2").reshape(-1, 2)
    rms = [float(np.sqrt(np.mean(c.astype(float) ** 2))) for c in samples.T]
    peaks = [
        float(np.argmax(abs(np.fft.rfft(c))) * 48000 / len(samples)) for c in samples.T
    ]
    if any(value < 3000 for value in rms):
        raise ValueError("Silent or attenuated fixture audio")
    if abs(peaks[0] - 440) > 1 or abs(peaks[1] - 880) > 1:
        raise ValueError("The left and right fixture tones are missing or swapped")
    return {
        "duration": float(metadata["format"]["duration"]),
        "peaks_hz": peaks,
        "rms": rms,
        "audio_start": float(audio["start_time"]),
        "video_start": float(video["start_time"]),
    }


def main():
    path = Path(sys.argv[1])
    result = verify(path)
    with tempfile.TemporaryDirectory(prefix="switch-clip-twins-") as directory:
        for name, options in [
            ("video-only", ["-an"]),
            ("silent", ["-af", "volume=0", "-c:a", "aac"]),
        ]:
            twin = Path(directory) / (name + ".mp4")
            subprocess.run(
                [
                    "ffmpeg",
                    "-v",
                    "error",
                    "-i",
                    str(path),
                    "-c:v",
                    "copy",
                    *options,
                    str(twin),
                ],
                check=True,
            )
            try:
                verify(twin)
            except ValueError:
                continue
            raise AssertionError(f"The broken {name} clip was accepted")
    result["negative_twins"] = ["video-only rejected", "silent audio rejected"]
    print(json.dumps(result))


if __name__ == "__main__":
    main()
