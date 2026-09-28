"""Send the open PowerPoint deck to SyncSlide and follow slide changes live."""

import argparse
import getpass
import html
import json
import os
import sys
import threading
import time
from urllib.parse import urlparse

import pythoncom
import requests
import win32com.client
from websockets.sync.client import connect

MSO_GROUP = 6
MSO_TRUE = -1
PUMP_INTERVAL_SECONDS = 0.05
ECHO_TIMEOUT_SECONDS = 5


def parse_presentation_url(url):
	parsed = urlparse(url)
	parts = [p for p in parsed.path.split("/") if p]
	if len(parts) < 2 or not parts[1].isdigit():
		sys.exit(f"Not a presentation URL: {url}")
	server = f"{parsed.scheme}://{parsed.netloc}"
	return server, parts[1]


def login(server, username, password):
	session = requests.Session()
	response = session.post(
		f"{server}/auth/login",
		data={"username": username, "password": password},
		allow_redirects=False,
	)
	if response.status_code not in (302, 303):
		sys.exit(f"Login failed (HTTP {response.status_code}).")
	return "; ".join(f"{c.name}={c.value}" for c in session.cookies)


def escape_markdown(text):
	text = html.escape(text, quote=False)
	if text.startswith("#"):
		text = "\\" + text
	return text


def shape_lines(shape):
	if shape.Type == MSO_GROUP:
		for i in range(1, shape.GroupItems.Count + 1):
			yield from shape_lines(shape.GroupItems(i))
		return
	if shape.HasTextFrame and shape.TextFrame.HasText:
		paragraphs = shape.TextFrame.TextRange.Paragraphs()
		for i in range(1, paragraphs.Count + 1):
			paragraph = paragraphs.Paragraphs(i)
			text = paragraph.Text.strip()
			if not text:
				continue
			if paragraph.ParagraphFormat.Bullet.Visible == MSO_TRUE:
				indent = "  " * (paragraph.IndentLevel - 1)
				yield f"{indent}- {escape_markdown(text)}"
			else:
				yield f"\n{escape_markdown(text)}\n"
	elif shape.AlternativeText:
		yield f"\nImage: {escape_markdown(shape.AlternativeText)}\n"


def slide_to_markdown(slide, fallback_title):
	shapes = slide.Shapes
	title_id = None
	title = fallback_title
	if shapes.HasTitle:
		title_shape = shapes.Title
		title_id = title_shape.Id
		title_text = " ".join(title_shape.TextFrame.TextRange.Text.split())
		if title_text:
			title = title_text
	lines = [f"## {escape_markdown(title)}"]
	for i in range(1, shapes.Count + 1):
		shape = shapes(i)
		if shape.Id != title_id:
			lines.extend(shape_lines(shape))
	return "\n".join(lines)


def deck_to_markdown(presentation):
	"""Return the markdown and a map from PowerPoint slide index to SyncSlide slide index."""
	sections = []
	index_map = {}
	for i in range(1, presentation.Slides.Count + 1):
		slide = presentation.Slides(i)
		if slide.SlideShowTransition.Hidden == MSO_TRUE:
			continue
		index_map[slide.SlideIndex] = len(sections)
		sections.append(slide_to_markdown(slide, f"Slide {i}"))
	return "\n\n".join(sections), index_map


class Bridge:
	def __init__(self, websocket):
		self.websocket = websocket
		self.index_map = {}

	def send(self, message_type, data):
		self.websocket.send(json.dumps({"type": message_type, "data": data}))

	def send_deck(self, presentation):
		markdown, self.index_map = deck_to_markdown(presentation)
		self.send("text", markdown)
		print(f"Sent {len(self.index_map)} slides from {presentation.Name}")

	def send_slide(self, powerpoint_index):
		index = self.index_map.get(powerpoint_index)
		if index is None:
			return
		self.send("slide", index)
		print(f"Slide {index + 1}")


class PowerPointEvents:
	bridge = None

	def OnSlideShowBegin(self, window):
		self.bridge.send_deck(window.Presentation)

	def OnSlideShowNextSlide(self, window):
		self.bridge.send_slide(window.View.Slide.SlideIndex)


def check_presenter(websocket):
	"""Send the current slide back. The server only echoes it to presenters."""
	current = None
	while current is None:
		message = json.loads(websocket.recv())
		if message["type"] == "slide":
			current = message["data"]
	websocket.send(json.dumps({"type": "slide", "data": current}))
	try:
		websocket.recv(timeout=ECHO_TIMEOUT_SECONDS)
	except TimeoutError:
		sys.exit("This account is not allowed to present this presentation.")


def drain(websocket):
	"""Read and drop server broadcasts so the connection does not back up."""
	try:
		for _ in websocket:
			pass
	except Exception:
		pass


def main():
	parser = argparse.ArgumentParser(description=__doc__)
	parser.add_argument("url", help="presentation URL, for example https://clippycat.ca/admin/12")
	parser.add_argument("--user", required=True, help="SyncSlide username")
	args = parser.parse_args()
	password = os.environ.get("SYNCSLIDE_PASSWORD") or getpass.getpass("Password: ")
	server, pid = parse_presentation_url(args.url)
	cookie = login(server, args.user, password)
	ws_url = server.replace("http", "ws", 1) + f"/ws/{pid}"
	# The server drops the connection when it gets a ping, so keepalive pings are off.
	with connect(ws_url, additional_headers={"Cookie": cookie}, ping_interval=None) as websocket:
		check_presenter(websocket)
		threading.Thread(target=drain, args=(websocket,), daemon=True).start()
		bridge = Bridge(websocket)
		PowerPointEvents.bridge = bridge
		app = win32com.client.DispatchWithEvents("PowerPoint.Application", PowerPointEvents)
		if app.SlideShowWindows.Count:
			window = app.SlideShowWindows(1)
			bridge.send_deck(window.Presentation)
			bridge.send_slide(window.View.Slide.SlideIndex)
		elif app.Presentations.Count:
			bridge.send_deck(app.ActivePresentation)
		print("Connected. Start the slideshow in PowerPoint. Press Ctrl+C to stop.")
		try:
			while True:
				pythoncom.PumpWaitingMessages()
				time.sleep(PUMP_INTERVAL_SECONDS)
		except KeyboardInterrupt:
			pass


if __name__ == "__main__":
	main()
