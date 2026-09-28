# pptx-bridge

Sends the deck open in PowerPoint to a SyncSlide presentation. This makes it possible for viewers to read the current slide from the browser, and pick up on changes live.

It is merely a proof of concept to prove that capturing and dispatching slide changes is possible from within Powerpoint. The next step is to build an add-on, which would place a "SyncSlide" button on the Powerpoint toolbar.

## Limitations

- This has only been tested on Windows. Since COM is used to hook into Powerpoint, it will not work on any other platforms (at the time of writing).
- Only the text from objects is represented in SyncSlide presentations.

## Setup

```
pip install -r requirements.txt
```

## Run

1. Open your deck in PowerPoint.
2. Run:

   ```
   python bridge.py https://syncslide.clippycat.ca/<user>/<id> --user <user>
   ```
   
   Replace <user> with your username, for example "admin", and <id> with an id that you have access to, for example "7"

3. Enter your password. You can also set it in `SYNCSLIDE_PASSWORD`.
4. Start the slideshow by pressing f5. From here you can press enter to move to the next slide, and backspace to move to the previous one.

You must own the presentation or be able to edit it.
