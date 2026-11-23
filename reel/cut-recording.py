"""Cuts two screen recordings of the Pine app into close-ups, with no text added.

    python3 reel/cut-recording.py <planets.mov> <pelican.mov> <out.mp4> [--stills <sheet.png>]

The first recording is a swarm writing six planet files, the one that shows the check of the answer; the second
is a swarm building the pelican game, whose sub-agents each own files of it and whose game runs in the agent's
browser. Each scene is a stretch of one recording and a box the camera creeps in on. A box is (middle x, middle
y, width) in the recording's pixels halved, less the recording's offset below; its height is width * 9 / 16.
"""
import subprocess, sys
from PIL import Image, ImageFilter

args = [a for a in sys.argv[1:]]
STILLS = None
if "--stills" in args:
	i = args.index("--stills")
	STILLS = args[i + 1]
	del args[i : i + 2]
PLANETS, PELICAN, OUT = args
W, H, FPS = 1920, 1080, 30

# path, size, where the halved coordinates start
REC = {
	"planets": (PLANETS, (3456, 2234), (340, 235)),  # the window's top left
	"pelican": (PELICAN, (3614, 2322), (0, 0)),
}

# (recording, from, to, seconds on screen, box at the start, box at the end). A shot holds still or creeps in a
# little; it never travels. Every shot shows only what is new since the one before, and only what matters: the
# job, the sub-agents at work, the board, the check by a sub-agent that did none of the work, what it found, the
# end; then the second job, its sub-agents each owning their files, its board, and what they made.
SCENES = [
	("planets", 2.0, 3.4, 1.8, (480, 330, 660), (480, 330, 630)),  # the job sent; "swarm leads it"
	("planets", 18.5, 21.0, 2.6, (1010, 355, 700), (1010, 355, 670)),  # waiting for 3, 2, 1 sub-agents; the board fills
	("planets", 37.4, 39.6, 2.4, (480, 603, 350), (480, 603, 340)),  # the answer, checked by a sub-agent that did none of it
	("planets", 46.9, 48.0, 1.8, (480, 645, 350), (480, 645, 340)),  # the check found something: round 2
	("planets", 57.5, 61.0, 3.0, (475, 728, 330), (475, 728, 320)),  # ended after 2 rounds
	("pelican", 5.5, 8.5, 3.0, (1150, 868, 540), (1150, 868, 520)),  # pixel-art shader and a world: four copies, each owning its files
	("pelican", 0.5, 3.0, 2.4, (1290, 235, 680), (1290, 235, 660)),  # waiting for 4 sub-agents, the board at 8 of 18
	("pelican", 9.5, 11.0, 2.4, (1342, 298, 640), (1342, 298, 620)),  # the board: done, failed, writing
	("pelican", 13.0, 18.5, 4.0, ("fit", 117, 95, 877, 987), ("fit", 147, 130, 847, 952)),  # the game they wrote, running
]


def ease(u):
	return u * u * (3 - 2 * u)


def box_at(rec, a, b, u):
	ox, oy = REC[rec][2]
	u = ease(u)
	if a[0] == "fit":  # a region shown whole, at the picture's height (see `fit`)
		return tuple((ox, oy)[i % 2] + 2 * (a[i + 1] + (b[i + 1] - a[i + 1]) * u) for i in range(4))
	cx, cy, w = (a[i] + (b[i] - a[i]) * u for i in range(3))
	h = w * 9 / 16
	return (ox + 2 * (cx - w / 2), oy + 2 * (cy - h / 2), ox + 2 * (cx + w / 2), oy + 2 * (cy + h / 2))


def frames(rec, t0, t1):
	"""The recording's frames from t0 to t1 at 60 a second."""
	path, (sw, sh), _ = REC[rec]
	p = subprocess.Popen(["ffmpeg", "-v", "error", "-ss", str(t0), "-i", path, "-t", str(t1 - t0 + 0.1), "-vf", "fps=60", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)  # it complains when cut off
	size = sw * sh * 3
	while True:
		buf = p.stdout.read(size)
		if len(buf) < size:
			break
		yield Image.frombuffer("RGB", (sw, sh), buf, "raw", "RGB", 0, 1)
	p.kill()


def fit(img, box):
	"""A region narrower than the picture: whole, at the picture's height, over a blurred and darkened copy of
	itself, so that nothing beside it (the app's other panels) is in view."""
	x0, y0, x1, y1 = box
	w = round((x1 - x0) * H / (y1 - y0))
	front = img.resize((w, H), Image.LANCZOS, box=box)
	back = img.resize((W // 8, H // 8), Image.BILINEAR, box=box).filter(ImageFilter.GaussianBlur(3)).resize((W, H), Image.BILINEAR)
	back = Image.eval(back, lambda v: int(v * 0.55))
	back.paste(front, ((W - w) // 2, 0))
	return back


writer = None if STILLS else subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-movflags", "+faststart", OUT], stdin=subprocess.PIPE)
shots, total = [], 0
for rec, t0, t1, dur, a, b in SCENES:
	sw, sh = REC[rec][1]
	n = round(dur * FPS)
	keep = {2, n - 3} if STILLS else None
	src = frames(rec, t0, t1)
	img, fi = next(src), 0
	for i in range(n):
		u = i / max(1, n - 1)
		t = (t1 - t0) * u  # seconds into the stretch
		while (fi + 1) / 60 <= t + 1e-6:
			nxt = next(src, None)
			if nxt is None:
				break
			img, fi = nxt, fi + 1
		if keep is not None and i not in keep:
			continue
		x0, y0, x1, y1 = box_at(rec, a, b, u)
		if a[0] == "fit":
			frame = fit(img, (x0, y0, x1, y1))
			if writer:
				writer.stdin.write(frame.tobytes())
			else:
				shots.append(frame.resize((640, 360)))
			continue
		dx = max(0, -x0) - max(0, x1 - sw)
		dy = max(0, -y0) - max(0, y1 - sh)
		frame = img.resize((W, H), Image.LANCZOS, box=(x0 + dx, y0 + dy, x1 + dx, y1 + dy))
		if writer:
			writer.stdin.write(frame.tobytes())
		else:
			shots.append(frame.resize((640, 360)))
	total += n
if writer:
	writer.stdin.close()
	writer.wait()
else:
	cols = 4
	sheet = Image.new("RGB", (640 * cols, 360 * ((len(shots) + cols - 1) // cols)))
	for j, f in enumerate(shots):
		sheet.paste(f, ((j % cols) * 640, (j // cols) * 360))
	sheet.save(STILLS)
print("frames", total, "seconds", total / FPS)
