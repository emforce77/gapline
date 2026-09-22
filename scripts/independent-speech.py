"""Independent CPU transcription for screening. This is not human ground truth."""
import importlib.metadata
import json
import pathlib
import time
from faster_whisper import WhisperModel
root = pathlib.Path('runtime/evaluation')
cases = json.loads((root/'cases.json').read_text())
model = WhisperModel('small', device='cpu', compute_type='int8', cpu_threads=4)
for case in cases:
    if case['id'] == 'eval-signal':
        continue
    out = root / (case['id'] + '.independent-speech.json')
    if out.exists():
        continue
    started = time.time()
    segments, info = model.transcribe('runtime/projects/' + case['id'] + '/clip.mp4', language='ko' if case['filmLanguage']=='ko-KR' else 'en', word_timestamps=True, vad_filter=True, condition_on_previous_text=False, beam_size=5)
    rows = [{'start':s.start,'end':s.end,'text':s.text,'no_speech_prob':s.no_speech_prob,'words':[{'start':w.start,'end':w.end,'word':w.word,'probability':w.probability} for w in s.words or []]} for s in segments]
    out.write_text(json.dumps({'source':'Systran/faster-whisper-small','version':importlib.metadata.version('faster-whisper'),'status':'independent-ASR-not-human-certified','segments':rows,'seconds':time.time()-started},ensure_ascii=False,indent=2))
    print(case['id'],len(rows),round(time.time()-started,1),flush=True)
