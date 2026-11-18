@echo off
cd /d "%~dp0bridge"
pip install pyserial websockets
echo.
echo Edit the COM port below (Device Manager -> Ports). Use --sim to test without hardware.
python bridge.py --port COM5 --baud 9600
pause
