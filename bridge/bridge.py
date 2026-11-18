"""VYORA bridge: gym-cycle Hall sensors (one Arduino, two bikes) -> game (browser) over WebSocket ws://127.0.0.1:8765

Install once:   pip install pyserial websockets
Run:            python bridge.py --port COM5          (Mac: --port /dev/tty.usbmodem14101)
No hardware:    python bridge.py --sim                (fake cadence, to test the link)

Arduino protocol (matches arduino_hall.ino, 9600 baud): each crank rotation prints one line
    "1"  -> pulse from bike 1 (player 1)
    "2"  -> pulse from bike 2 (player 2)
RPM = 60 / (seconds between two pulses). It drops to 0 when pedalling stops.
Other inputs: UDP JSON {"rpm":N,"player":0|1} on 127.0.0.1:5005.
"""
import argparse, asyncio, json, time

ap = argparse.ArgumentParser()
ap.add_argument('--port'); ap.add_argument('--baud', type=int, default=9600)
ap.add_argument('--sim', action='store_true'); ap.add_argument('--udp', type=int, default=5005)
ap.add_argument('--pulses-per-rev', type=float, default=1.0, help='magnets per crank rotation (default 1)')
ap.add_argument('--min-gap', type=float, default=0.12, help='ignore pulses closer than this many seconds (debounce)')
args = ap.parse_args()

clients = set()

async def handler(ws):
    clients.add(ws)
    try:
        async for _ in ws: pass
    finally: clients.discard(ws)

async def push(player, rpm):
    msg = json.dumps({'player': player, 'rpm': round(rpm, 1)})
    for c in list(clients):
        try: await c.send(msg)
        except Exception: clients.discard(c)

class Pulse:
    """RPM from the time between pulses; holds the value while pedalling, decays to 0 when pulses stop."""
    def __init__(self): self.last = None; self.rpm = 0.0
    def tick(self, now):
        if self.last is not None:
            dt = now - self.last
            if dt < args.min_gap: return                      # contact bounce / double trigger
            self.rpm = 60.0 / dt / args.pulses_per_rev if dt < 3.0 else 0.0
        self.last = now
    def current(self, now):
        if self.last is None: return 0.0
        gap = now - self.last; expect = 60.0 / max(self.rpm, 1.0) / args.pulses_per_rev
        if gap > 3.0: return 0.0
        if gap > expect * 1.5: return self.rpm * max(0.0, 1 - (gap - expect * 1.5) / 1.5)   # smooth fade-out
        return self.rpm

async def serial_task(port):
    import serial
    ser = serial.Serial(port, args.baud, timeout=0); pl = [Pulse(), Pulse()]; buf = b''; last = 0
    print(f'listening on {port} @ {args.baud}  ("1" = bike 1, "2" = bike 2)')
    while True:
        buf += ser.read(256)
        while b'\n' in buf:
            line, buf = buf.split(b'\n', 1); t = line.decode(errors='ignore').strip(); now = time.time()
            if t == '1': pl[0].tick(now)
            elif t == '2': pl[1].tick(now)
        now = time.time()
        if now - last > 0.05:
            last = now
            for i in (0, 1): await push(i, pl[i].current(now))
        await asyncio.sleep(0.005)

class Udp(asyncio.DatagramProtocol):
    def datagram_received(self, data, addr):
        try: d = json.loads(data.decode()); asyncio.get_event_loop().create_task(push(int(d.get('player', 0)), float(d['rpm'])))
        except Exception: pass

async def sim_task():
    import math; t0 = time.time()
    while True:
        t = time.time() - t0
        await push(0, max(0, 55 + 25 * math.sin(t * 0.5))); await push(1, max(0, 45 + 30 * math.sin(t * 0.4 + 1)))
        await asyncio.sleep(0.05)

async def main():
    import websockets
    async with websockets.serve(handler, '127.0.0.1', 8765):
        print('WebSocket on ws://127.0.0.1:8765  (open the game: "BIKE LINK" shows bottom-right)')
        loop = asyncio.get_running_loop()
        try: await loop.create_datagram_endpoint(Udp, local_addr=('127.0.0.1', args.udp))
        except OSError as e: print('UDP not started:', e)
        if args.sim: await sim_task()
        elif args.port: await serial_task(args.port)
        else: print('No --port given. Use --port COM5 (or --sim to test).'); await asyncio.Future()

asyncio.run(main())
