import json
from datetime import timedelta

file = open("recording.json")
# take off the "slidedata=" header
d = file.read(11)
data = json.load(file)

print("WEBVTT\n")
# https://stackoverflow.com/questions/45140034/python-convert-seconds-to-datetime-date-and-time
prev_time = timedelta()

for item in data:
	time = timedelta(seconds=float(item["time"]))
	p = "00:{:02d}:{:02d}.{:04.0f}".format(prev_time.seconds // 60, prev_time.seconds % 60, prev_time.microseconds / 100)
	n = "00:{:02d}:{:02d}.{:04.0f}".format(time.seconds // 60, time.seconds % 60, time.microseconds / 100)
	print(f"{p} --> {n}")
	print(json.dumps({"slide": item["slide"], "title": item["title"], "data": item["content"]}))
	print()
	prev_time = time
