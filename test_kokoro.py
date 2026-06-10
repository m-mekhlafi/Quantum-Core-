from kokoro_onnx import Kokoro
import soundfile as sf
import subprocess
import uuid
import os

# تحديد مسارات الملفات (تأكد من وجودها في هذا المسار)
onnx_path = os.path.expanduser('kokoro-v1.0.onnx')
voices_path = os.path.expanduser('voices-v1.0.bin')

try:
    engine = Kokoro(onnx_path, voices_path)
    print("Available voices:", engine.get_voices())

    # تجربة الصوت
    samples, sr = engine.create("Hello, this is a successful test from Kokoro.", voice="af_heart", speed=1.0)
    out = f"test_{uuid.uuid4().hex}.wav"
    sf.write(out, samples, sr)
    
    # تشغيل الصوت
    subprocess.run(["aplay", "-q", out])
    os.remove(out)
    print("Done! الصوت يعمل بنجاح.")
except Exception as e:
    print(f"حدث خطأ: {e}")
