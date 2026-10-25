"""Converte texto em áudio (WAV) com o modelo Kokoro via sherpa-onnx.

Uso: tts.py <model_dir> <texto> <saida.wav> [speaker_id] [speed]
"""
import sys

import numpy as np
import sherpa_onnx
import soundfile as sf

model_dir, text, out = sys.argv[1], sys.argv[2], sys.argv[3]
sid = int(sys.argv[4]) if len(sys.argv) > 4 else 43
speed = float(sys.argv[5]) if len(sys.argv) > 5 else 1.05

tts = sherpa_onnx.OfflineTts(
    sherpa_onnx.OfflineTtsConfig(
        model=sherpa_onnx.OfflineTtsModelConfig(
            kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
                model=f"{model_dir}/model.onnx",
                voices=f"{model_dir}/voices.bin",
                tokens=f"{model_dir}/tokens.txt",
                lexicon=f"{model_dir}/lexicon-us-en.txt,{model_dir}/lexicon-zh.txt",
                data_dir=f"{model_dir}/espeak-ng-data",
                dict_dir=f"{model_dir}/dict",
                lang="pt-br",
            ),
            num_threads=2,
        )
    )
)
audio = tts.generate(text, sid=sid, speed=speed)
samples = np.asarray(audio.samples, dtype=np.float32)
peak = float(np.abs(samples).max()) or 1.0
samples = samples / peak * 0.9
sf.write(out, samples, audio.sample_rate)
print(len(samples) / audio.sample_rate)
