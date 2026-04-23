# FlowWhips Debug Logs
# Generated: 2026-04-23

## System Info
- Mac IP: 192.168.31.102
- Daemon Port: 3210 (HTTP), 3211 (WebSocket)
- Simulator: iPhone 17 Pro (61AD7ECE-B0ED-4119-891F-D84DC0881BA4)

## Daemon Status
Running on ports:
- HTTP: http://192.168.31.102:3210
- WebSocket: ws://192.168.31.102:3211

## iOS Connection Instructions
1. Open FlowWhips app on iPhone
2. Go to Settings tab
3. Select "Local" mode (not "Remote")
4. Enter HTTP URL: http://192.168.31.102:3210
5. Tap Connect
6. Go to Terminal tab to access running agents

## Notes
- Daemon must be running on Mac
- iOS app must connect to Mac's local IP (not localhost)
- WebSocket auto-derives from HTTP URL on port +1