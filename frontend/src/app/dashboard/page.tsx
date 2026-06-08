'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { serverUrl } from '@/lib/config';
import { bodyFont } from '@/lib/fonts';
import { Telemetry, ControlCommand } from '@/types/drone';

import Header from '@/components/dashboard/Header';
import Controls from '@/components/dashboard/Controls';
import CameraFeed from '@/components/dashboard/CameraFeed';
import SensorData from '@/components/dashboard/SensorData';

const PointCloudViewer = dynamic(
	() => import('@/components/PointCloudViewer'),
	{
		ssr: false,
		loading: () => (
			<div className="flex h-full items-center justify-center text-sm text-gray-400">
				Loading 3D viewer…
			</div>
		)
	}
);

const WS_PATH = '/api/v1/drone/ws';

const toWsUrl = (base?: string, path = WS_PATH) => {
	if (!base) return null;
	return base.replace(/^http/, 'ws') + path;
};

export default function Page() {
	const [telemetry, setTelemetry] = useState<Telemetry>({});
	const [connection, setConnection] = useState('connecting');
	const wsRef = useRef<WebSocket | null>(null);
	const commandRef = useRef<ControlCommand>({
		roll: 0,
		pitch: 0,
		yaw: 0,
		altitude_delta: 0
	});

	useEffect(() => {
		const wsUrl = toWsUrl(serverUrl);
		if (!wsUrl) return;

		const ws = new WebSocket(wsUrl);
		wsRef.current = ws;

		ws.onopen = () => setConnection('open');
		ws.onclose = () => setConnection('closed');
		ws.onerror = () => setConnection('closed');

		ws.onmessage = (event) => {
			try {
				const payload = JSON.parse(event.data);
				if (payload.type === 'telemetry') {
					setTelemetry(payload.data ?? {});
				}
				if (payload.type === 'hello') {
					setTelemetry(payload.telemetry ?? {});
				}
			} catch {
				// ignore malformed messages
			}
		};

		const interval = setInterval(() => {
			if (ws.readyState !== WebSocket.OPEN) return;
			ws.send(
				JSON.stringify({
					type: 'control',
					command: commandRef.current
				})
			);
		}, 100);

		return () => {
			clearInterval(interval);
			ws.close();
		};
	}, []);

	const updateCommand = (next: Partial<ControlCommand>) => {
		commandRef.current = {
			...commandRef.current,
			...next
		};
	};

	const sendOnce = (command: Partial<ControlCommand>) => {
		updateCommand(command);
		const ws = wsRef.current;
		if (ws && ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify({ type: 'control', command: commandRef.current }));
		}
		if (command.altitude_delta) {
			commandRef.current.altitude_delta = 0;
		}
	};

	return (
		<div
			className={`${bodyFont.className} min-h-screen bg-gray-50/50 pb-16 text-gray-900`}
		>
			<div className="">
				<Header connection={connection} telemetry={telemetry}>
					{/* Left: Controls Card */}
					<div className="h-full w-full shrink-0 lg:w-80">
						<Controls
							telemetry={telemetry}
							commandRef={commandRef}
							updateCommand={updateCommand}
							sendOnce={sendOnce}
						/>
					</div>
				</Header>

				<main className="flex flex-col gap-6">
					{/* Top Interaction Row */}
					<div className="flex h-[500px] flex-col gap-6 lg:flex-row">
						{/* Middle: Camera Feed */}
						<div className="h-full min-w-0 flex-1">
							<CameraFeed />
						</div>

						{/* Right: Point Cloud Viewer (Lidar) */}
						<div className="h-full min-w-0 flex-1">
							<div className="flex h-full flex-col rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
								<p className="mb-4 text-xs font-semibold tracking-[0.2em] text-gray-400 uppercase">
									3D Point Cloud
								</p>
								<div className="flex w-full flex-1 items-center justify-center overflow-hidden rounded-2xl border border-gray-100 bg-gray-50">
									<PointCloudViewer style={{ width: '100%', height: '100%' }} />
								</div>
							</div>
						</div>
					</div>

					{/* Bottom Row: Sensor Data */}
					<SensorData telemetry={telemetry} />
				</main>
			</div>
		</div>
	);
}
