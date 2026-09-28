# pptx-bridge

Sends the deck open in PowerPoint to a SyncSlide presentation. Viewers follow your slide changes live.

Windows only. Text only.

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

3. Enter your password. You can also set it in `SYNCSLIDE_PASSWORD`.
4. Start the slideshow.

You must own the presentation or be able to edit it.
