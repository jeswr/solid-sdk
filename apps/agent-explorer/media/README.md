<!-- AUTHORED-BY Claude Opus 5.5 -->
# Walkthrough video

The home page plays `answerable-walkthrough.mp4` from this folder, with the captions in
`answerable-walkthrough.vtt`. The video is not committed. It is a 1280-pixel re-encode of the
narrated walkthrough, kept under 15 MB so the hosted preview can carry it:

```sh
ffmpeg -i answerable-walkthrough-source.mp4 -map 0:v:0 -vf scale=1280:-2 -c:v libx264 \
  -preset slow -tune animation -b:v 250k -pass 1 -an -f mp4 /dev/null
ffmpeg -i answerable-walkthrough-source.mp4 -map 0:v:0 -map 0:a:0 -vf scale=1280:-2 \
  -c:v libx264 -preset slow -tune animation -b:v 250k -pass 2 -c:a aac -b:a 64k -ac 1 \
  -movflags +faststart answerable-walkthrough.mp4
```

The build scripts copy this folder when it exists. Without the video the page shows an empty
player.
