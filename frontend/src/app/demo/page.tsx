'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2, Target, Wifi, WifiOff } from 'lucide-react';
import DemoCameraFeed from '@/components/dashboard/DemoCameraFeed';
import Controls from '@/components/dashboard/Controls';
import FloatingPanel from '@/components/dashboard/FloatingPanel';
import DroneStatsHUD from '@/components/dashboard/DroneStatsHUD';
import MissionDialog from '@/components/dashboard/MissionDialog';
import MissionMapFloat from '@/components/dashboard/MissionMapFloat';
import MissionLog from '@/components/dashboard/MissionLog';
import { useMapData } from '@/hooks/useMapData';
import { serverUrl } from '@/lib/config';
import type { ControlCommand, Telemetry } from '@/types/drone';
import SlamViewer from '@/components/dashboard/SlamViewer';

const PointCloudViewer = dynamic(
	() => import('@/components/PointCloudViewer'),
	{
		ssr: false,
		loading: () => (
			<div
				className="flex h-full items-center justify-center font-mono text-xs"
				style={{ color: 'rgba(0,255,136,0.4)' }}
			>
				Initialising 3D Viewer…
			</div>
		)
	}
);

const WS_PATH = '/api/v1/demo/ws';

const toWsUrl = (base?: string, path = WS_PATH) => {
	if (!base) return null;
	return base.replace(/^http/, 'ws') + path;
};

// ─── Responsive default positions ──────────────────────────────────────────────
const iw = () => (typeof window !== 'undefined' ? window.innerWidth : 1440);
const ih = () => (typeof window !== 'undefined' ? window.innerHeight : 900);

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

	const [pointCloudMaximized, setPointCloudMaximized] = useState(false);
	const [missionDialogOpen, setMissionDialogOpen] = useState(false);

	const wsUrl = toWsUrl(serverUrl);
	const mapData = useMapData(wsUrl);

	// ── Main telemetry WebSocket ───────────────────────────────────────────────
	useEffect(() => {
		if (!wsUrl) return;
		const ws = new WebSocket(wsUrl);
		wsRef.current = ws;

		ws.onopen = () => setConnection('open');
		ws.onclose = () => setConnection('closed');
		ws.onerror = () => setConnection('closed');

		ws.onmessage = (event) => {
			try {
				const payload = JSON.parse(event.data);
				if (payload.type === 'telemetry') setTelemetry(payload.data ?? {});
				if (payload.type === 'hello') setTelemetry(payload.telemetry ?? {});
			} catch {
				// ignore malformed messages
			}
		};

		const interval = setInterval(() => {
			if (ws.readyState !== WebSocket.OPEN) return;
			ws.send(JSON.stringify({ type: 'control', command: commandRef.current }));
		}, 100);

		return () => {
			clearInterval(interval);
			ws.close();
		};
	}, [wsUrl]);

	const updateCommand = (next: Partial<ControlCommand>) => {
		commandRef.current = { ...commandRef.current, ...next };
	};

	const sendOnce = (command: Partial<ControlCommand>) => {
		updateCommand(command);
		const ws = wsRef.current;
		if (ws && ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify({ type: 'control', command: commandRef.current }));
		}
		if (command.altitude_delta) commandRef.current.altitude_delta = 0;
	};

	const isConnected = connection === 'open';

	// ── Point Cloud panel maximize/restore header buttons ────────────────────
	const pointCloudHeader = (
		<button
			onClick={() => setPointCloudMaximized((v) => !v)}
			className="flex h-6 w-6 items-center justify-center rounded-md transition-all hover:opacity-100 active:scale-90"
			style={{
				background: 'rgba(255,255,255,0.08)',
				border: '1px solid rgba(255,255,255,0.15)',
				color: 'rgba(255,255,255,0.7)',
				opacity: 0.8
			}}
			title={pointCloudMaximized ? 'Restore' : 'Maximize'}
		>
			{pointCloudMaximized ? (
				<Minimize2 className="h-3 w-3" />
			) : (
				<Maximize2 className="h-3 w-3" />
			)}
		</button>
	);

	// ── Mission button header ────────────────────────────────────────────────
	const missionHeader = (
		<button
			onClick={() => setMissionDialogOpen(true)}
			className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[9px] font-bold tracking-wider uppercase transition-all hover:opacity-100 active:scale-95"
			style={{
				background: 'rgba(0,255,136,0.12)',
				border: '1px solid rgba(0,255,136,0.3)',
				color: '#00ff88',
				opacity: 0.9
			}}
		>
			<Target className="h-3 w-3" />
			&nbsp; Plan Mission
		</button>
	);

	return (
		<div
			className="fixed inset-0 overflow-hidden"
			style={{ background: '#000' }}
		>
			{/* ── Top Center Demo Badge ───────────────────────────────── */}
			<div className="absolute top-4 left-1/2 -translate-x-1/2 z-50">
				<div
					className="flex items-center gap-2 rounded-full px-6 py-2 text-xs font-bold tracking-widest uppercase"
					style={{
						background: 'rgba(255, 0, 0, 0.4)',
						border: '1px solid rgba(255, 100, 100, 0.6)',
						color: '#ffaaaa',
						backdropFilter: 'blur(8px)',
						boxShadow: '0 4px 20px rgba(255, 0, 0, 0.2)'
					}}
				>
					<Target className="h-4 w-4" />
					REAL FOOTAGE DEMO MODE
				</div>
			</div>

			{/* ── Layer 0: Camera Background ─────────────────────────────────── */}
			{!pointCloudMaximized && (
				<DemoCameraFeed className="absolute inset-0 h-full w-full" />
			)}

			{/* Subtle vignette + scanline overlay for game feel */}
			<div
				className="pointer-events-none absolute inset-0 z-10"
				style={{
					background:
						'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.55) 100%)'
				}}
			/>
			{/* Thin scanlines */}
			<div
				className="pointer-events-none absolute inset-0 z-10 opacity-[0.03]"
				style={{
					backgroundImage:
						'repeating-linear-gradient(0deg, rgba(0,0,0,0.8) 0px, rgba(0,0,0,0.8) 1px, transparent 1px, transparent 2px)',
					backgroundSize: '100% 2px'
				}}
			/>

			{/* ── Floating Panel: 3D Point Cloud (Left Center) ───────────────── */}
			<FloatingPanel
				id="panel-pointcloud"
				title="3D Point Cloud"
				defaultX={20}
				defaultY={Math.round(ih() * 0.18)}
				headerExtra={pointCloudHeader}
				style={
					pointCloudMaximized
						? {
								left: 0,
								top: 0,
								width: '100vw',
								height: '100vh',
								borderRadius: 0,
								zIndex: 20
							}
						: { width: 380, height: 300 }
				}
			>
				<div
					className="relative"
					style={
						pointCloudMaximized
							? { height: 'calc(100vh - 36px)' }
							: { height: 256 }
					}
				>
					<PointCloudViewer style={{ width: '100%', height: '100%' }} />
					{/* Bottom-left watermark */}
					<div
						className="pointer-events-none absolute bottom-2 left-2 rounded-md px-2 py-0.5 font-mono text-[9px]"
						style={{
							background: 'rgba(0,0,0,0.5)',
							color: 'rgba(0,255,136,0.6)',
							border: '1px solid rgba(0,255,136,0.15)'
						}}
					>
						LIDAR · 3D POINT CLOUD
					</div>
				</div>
			</FloatingPanel>

			{/* ── Floating Panel: Drone Stats HUD (Top Right) ────────────────── */}
			<FloatingPanel
				id="panel-stats"
				title="Drone Stats"
				defaultX={Math.round(iw() + 70)}
				defaultY={20}
			>
				<DroneStatsHUD telemetry={telemetry} connection={connection} />
			</FloatingPanel>

			{/* ── Floating Panel: Mission Trigger (Top Left, near point cloud) ── */}
			<FloatingPanel
				id="panel-mission"
				title="Mission"
				defaultX={20}
				defaultY={20}
				headerExtra={missionHeader}
			>
				<div className="px-3 pt-1 pb-3">
					<div className="flex flex-col gap-1">
						{/* Mission status pill */}
						<div
							className="flex items-center justify-between rounded-lg px-3 py-2"
							style={{
								background: 'rgba(255,255,255,0.04)',
								border: '1px solid rgba(255,255,255,0.07)'
							}}
						>
							<span
								className="font-mono text-[9px] uppercase"
								style={{ color: 'rgba(255,255,255,0.4)' }}
							>
								Status
							</span>
							<span
								className="flex items-center gap-1 text-[9px] font-bold uppercase"
								style={{
									color: mapData.missionActive
										? '#00ff88'
										: 'rgba(255,255,255,0.4)'
								}}
							>
								<span
									className="h-1.5 w-1.5 rounded-full"
									style={{
										background: mapData.missionActive
											? '#00ff88'
											: 'rgba(255,255,255,0.25)',
										boxShadow: mapData.missionActive
											? '0 0 6px #00ff88'
											: 'none'
									}}
								/>
								{mapData.missionActive ? 'AUTONOMOUS SEARCH' : 'STANDBY'}
							</span>
						</div>
						{/* Detection count */}
						{(mapData.confirmedDetections.length > 0 ||
							mapData.people.length > 0) && (
							<div
								className="flex items-center justify-between rounded-lg px-3 py-1.5"
								style={{
									background: 'rgba(239,68,68,0.08)',
									border: '1px solid rgba(239,68,68,0.2)'
								}}
							>
								<span
									className="font-mono text-[9px] uppercase"
									style={{ color: 'rgba(239,68,68,0.6)' }}
								>
									Detections
								</span>
								<span
									className="font-mono text-sm font-bold"
									style={{ color: '#ef4444' }}
								>
									{mapData.confirmedDetections.length > 0
										? mapData.confirmedDetections.length
										: mapData.people.length}
								</span>
							</div>
						)}
					</div>
				</div>
			</FloatingPanel>

			{/* ── Floating Panel: Manual Controls (Bottom Right) ─────────────── */}
			<FloatingPanel
				id="panel-controls"
				title="Manual Controls"
				defaultX={Math.round(iw() + 130)}
				defaultY={Math.round(ih() - 480)}
			>
				<Controls
					telemetry={telemetry}
					commandRef={commandRef}
					updateCommand={updateCommand}
					sendOnce={sendOnce}
				/>
			</FloatingPanel>

			{/* ── Mission Map Float (appears when mission active) ─────────────── */}
			{mapData.missionActive && (
				<MissionMapFloat
					mapData={mapData}
					onManageMission={() => setMissionDialogOpen(true)}
					defaultX={Math.round(iw() / 2 - 150)}
					defaultY={Math.round(ih() - 300)}
				/>
			)}

			{/* ── Mission Log (always visible once something is logged) ──────── */}
			{mapData.missionLog.length > 0 && (
				<MissionLog
					entries={mapData.missionLog}
					defaultX={20}
					defaultY={Math.round(ih() - 400)}
				/>
			)}

			{/* ── Status Bar (Bottom Left) ────────────────────────────────────── */}
			<div
				className="fixed bottom-4 left-4 z-30 flex items-center gap-3 rounded-full px-4 py-1.5"
				style={{
					background: 'rgba(6,10,22,0.75)',
					backdropFilter: 'blur(12px)',
					border: '1px solid rgba(255,255,255,0.08)'
				}}
			>
				{isConnected ? (
					<Wifi className="h-3 w-3" style={{ color: '#00ff88' }} />
				) : (
					<WifiOff className="h-3 w-3" style={{ color: '#ef4444' }} />
				)}
				<span
					className="font-mono text-[9px] uppercase"
					style={{ color: isConnected ? '#00ff88' : '#ef4444' }}
				>
					{isConnected ? 'LINK' : 'OFFLINE'}
				</span>
				{telemetry.time != null && (
					<>
						<span
							className="h-3 w-px"
							style={{ background: 'rgba(255,255,255,0.15)' }}
						/>
						<span
							className="font-mono text-[9px]"
							style={{ color: 'rgba(255,255,255,0.4)' }}
						>
							T+{telemetry.time.toFixed(1)}s
						</span>
					</>
				)}
				<span
					className="h-3 w-px"
					style={{ background: 'rgba(255,255,255,0.15)' }}
				/>
				<span
					className="font-mono text-[9px]"
					style={{ color: 'rgba(255,255,255,0.3)' }}
				>
					DRONE OPS
				</span>
			</div>

			{/* ── Mission Dialog (portal-style) ──────────────────────────────── */}
			{missionDialogOpen && (
				<MissionDialog
					mapData={mapData}
					onClose={() => setMissionDialogOpen(false)}
				/>
			)}
		</div>
	);
}
