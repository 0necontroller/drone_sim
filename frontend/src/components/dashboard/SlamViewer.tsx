'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Detection {
	x: number;
	y: number;
	ts?: number;
	id?: string;
}

interface DronePos {
	x: number; // world metres (Webots X)
	y: number; // world metres (Webots Y / map horizontal)
	yaw?: number;
}

interface SlamMeta {
	map_pixels: number; // e.g. 800
	map_meters: number; // e.g. 40.0  — full side length
	slam_x_mm: number;
	slam_y_mm: number;
	slam_theta_deg: number;
}

interface SlamViewerProps {
	/** WebSocket URL of the FastAPI dashboard socket, e.g. ws://localhost:8001/api/v1/drone/ws */
	wsUrl: string;
	/** Canvas display size in CSS pixels (square). Default 520 */
	size?: number;
	/** Show the raw SLAM map underneath the overlay. Default true */
	showSlamMap?: boolean;
	/** Show ghost dots for all_pedestrians (demo mode). Default true */
	showAllPeds?: boolean;
	className?: string;
}

// ── Coordinate helpers ────────────────────────────────────────────────────────
// BreezySLAM stores the map with origin at bottom-left, X→right, Y→up.
// slam_x_mm / slam_y_mm are the SLAM-estimated pose in map-millimetres.
// We need to translate that to canvas pixels.
//
// Canvas origin is top-left, so we flip Y.
//
//   cx = (slam_x_mm / 1000) / map_meters * canvas_px
//   cy = canvas_px - (slam_y_mm / 1000) / map_meters * canvas_px
//
// For detections we receive Webots world metres (x, y).
// The SLAM map is centred on where the drone started (0,0 in Webots).
// So world_x=0 → centre of map, world_x = +map_meters/2 → right edge.
//
//   cx = (world_x + map_meters/2) / map_meters * canvas_px
//   cy = canvas_px - (world_y + map_meters/2) / map_meters * canvas_px

function worldToCanvas(
	wx: number,
	wy: number,
	mapMeters: number,
	canvasPx: number
): [number, number] {
	const cx = ((wx + mapMeters / 2) / mapMeters) * canvasPx;
	const cy = canvasPx - ((wy + mapMeters / 2) / mapMeters) * canvasPx;
	return [cx, cy];
}

function slamPoseToCanvas(
	x_mm: number,
	y_mm: number,
	mapMeters: number,
	canvasPx: number
): [number, number] {
	const cx = (x_mm / 1000 / mapMeters) * canvasPx;
	const cy = canvasPx - (y_mm / 1000 / mapMeters) * canvasPx;
	return [cx, cy];
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function SlamViewer({
	wsUrl,
	size = 520,
	showSlamMap = true,
	showAllPeds = true,
	className = ''
}: SlamViewerProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const slamImgRef = useRef<HTMLImageElement | null>(null);
	const rafRef = useRef<number>(0);

	const [meta, setMeta] = useState<SlamMeta | null>(null);
	const [dronePos, setDronePos] = useState<DronePos | null>(null);
	const [detections, setDetections] = useState<Detection[]>([]);
	const [allPeds, setAllPeds] = useState<Detection[]>([]);
	const [waypoints, setWaypoints] = useState<[number, number][]>([]);
	const [connected, setConnected] = useState(false);
	const [frameCount, setFrameCount] = useState(0);
	const [lastFps, setLastFps] = useState(0);

	// FPS tracking
	const fpsRef = useRef({ count: 0, last: performance.now() });

	// ── WebSocket ───────────────────────────────────────────────────────────────
	useEffect(() => {
		let ws: WebSocket;
		let dead = false;

		function connect() {
			ws = new WebSocket(wsUrl);

			ws.onopen = () => {
				if (!dead) setConnected(true);
			};
			ws.onclose = () => {
				setConnected(false);
				if (!dead) setTimeout(connect, 2000); // auto-reconnect
			};
			ws.onerror = () => ws.close();

			ws.onmessage = (evt: MessageEvent) => {
				let msg: Record<string, unknown>;
				try {
					msg = JSON.parse(evt.data as string);
				} catch {
					return;
				}

				switch (msg.type) {
					case 'slam_update': {
						// Decode the base64 PNG map into an offscreen Image
						const b64 = msg.map_b64 as string;
						if (b64) {
							const img = new Image();
							img.onload = () => {
								slamImgRef.current = img;
							};
							img.src = 'data:image/png;base64,' + b64;
						}
						setMeta({
							map_pixels: msg.map_pixels as number,
							map_meters: msg.map_meters as number,
							slam_x_mm: msg.slam_x_mm as number,
							slam_y_mm: msg.slam_y_mm as number,
							slam_theta_deg: msg.slam_theta_deg as number
						});
						// FPS counter
						fpsRef.current.count++;
						const now = performance.now();
						if (now - fpsRef.current.last >= 1000) {
							setLastFps(fpsRef.current.count);
							fpsRef.current.count = 0;
							fpsRef.current.last = now;
						}
						setFrameCount((c) => c + 1);
						break;
					}

					case 'telemetry': {
						const d = msg.data as Record<string, number> | undefined;
						if (d) {
							setDronePos({ x: d.x ?? 0, y: d.y ?? 0, yaw: d.yaw ?? 0 });
						}
						break;
					}

					case 'detections': {
						setDetections((msg.people as Detection[]) ?? []);
						break;
					}

					case 'supervisor_state': {
						if (msg.confirmed_detections) {
							setDetections(msg.confirmed_detections as Detection[]);
						}
						if (showAllPeds && msg.all_pedestrians) {
							setAllPeds(msg.all_pedestrians as Detection[]);
						}
						if (msg.drone) {
							const d = msg.drone as { x: number; y: number };
							setDronePos((prev) => ({ ...prev, x: d.x, y: d.y }));
						}
						break;
					}

					case 'flight_plan': {
						const wps = (msg.waypoints as [number, number, number][]) ?? [];
						setWaypoints(wps.map((w) => [w[0], w[1]]));
						break;
					}

					case 'mission_complete': {
						setWaypoints([]);
						break;
					}
				}
			};
		}

		connect();
		return () => {
			dead = true;
			ws?.close();
		};
	}, [wsUrl, showAllPeds]);

	// ── Canvas render loop ──────────────────────────────────────────────────────
	const draw = useCallback(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		const S = size;
		const MM = meta?.map_meters ?? 40;

		ctx.clearRect(0, 0, S, S);

		// 1. Background
		ctx.fillStyle = '#0d1117';
		ctx.fillRect(0, 0, S, S);

		// 2. SLAM occupancy map
		if (showSlamMap && slamImgRef.current) {
			// BreezySLAM writes map with Y=0 at bottom — drawImage paints top-left
			// so we flip vertically via a transform
			ctx.save();
			ctx.translate(0, S);
			ctx.scale(1, -1);
			ctx.drawImage(slamImgRef.current, 0, 0, S, S);
			ctx.restore();
		}

		// 3. Grid lines (every 5 m)
		ctx.strokeStyle = 'rgba(255,255,255,0.06)';
		ctx.lineWidth = 0.5;
		const step = (5 / MM) * S;
		for (let x = 0; x < S; x += step) {
			ctx.beginPath();
			ctx.moveTo(x, 0);
			ctx.lineTo(x, S);
			ctx.stroke();
		}
		for (let y = 0; y < S; y += step) {
			ctx.beginPath();
			ctx.moveTo(0, y);
			ctx.lineTo(S, y);
			ctx.stroke();
		}

		// 4. Origin crosshair (world 0,0)
		const [ox, oy] = worldToCanvas(0, 0, MM, S);
		ctx.strokeStyle = 'rgba(255,255,255,0.15)';
		ctx.lineWidth = 1;
		ctx.setLineDash([3, 3]);
		ctx.beginPath();
		ctx.moveTo(ox, 0);
		ctx.lineTo(ox, S);
		ctx.stroke();
		ctx.beginPath();
		ctx.moveTo(0, oy);
		ctx.lineTo(S, oy);
		ctx.stroke();
		ctx.setLineDash([]);

		// 5. Flight path
		if (waypoints.length > 1) {
			ctx.strokeStyle = '#22d3ee';
			ctx.lineWidth = 1.5;
			ctx.setLineDash([5, 4]);
			ctx.beginPath();
			waypoints.forEach(([wx, wy], i) => {
				const [cx, cy] = worldToCanvas(wx, wy, MM, S);
				i === 0 ? ctx.moveTo(cx, cy) : ctx.lineTo(cx, cy);
			});
			ctx.stroke();
			ctx.setLineDash([]);
			waypoints.forEach(([wx, wy], i) => {
				const [cx, cy] = worldToCanvas(wx, wy, MM, S);
				ctx.beginPath();
				ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
				ctx.fillStyle = '#22d3ee';
				ctx.fill();
				ctx.fillStyle = 'rgba(255,255,255,0.7)';
				ctx.font = 'bold 8px monospace';
				ctx.textAlign = 'center';
				ctx.fillText(String(i + 1), cx, cy - 7);
			});
		}

		// 6. Ghost pedestrians (demo layer)
		if (showAllPeds) {
			allPeds.forEach(({ x, y }) => {
				const [cx, cy] = worldToCanvas(x, y, MM, S);
				ctx.beginPath();
				ctx.arc(cx, cy, 4, 0, Math.PI * 2);
				ctx.fillStyle = 'rgba(180,180,180,0.15)';
				ctx.strokeStyle = 'rgba(255,255,255,0.12)';
				ctx.lineWidth = 1;
				ctx.fill();
				ctx.stroke();
			});
		}

		// 7. Confirmed / geo detections
		detections.forEach(({ x, y, id }) => {
			const [cx, cy] = worldToCanvas(x, y, MM, S);
			// glow ring
			ctx.beginPath();
			ctx.arc(cx, cy, 11, 0, Math.PI * 2);
			ctx.fillStyle = 'rgba(239,68,68,0.18)';
			ctx.fill();
			// dot
			ctx.beginPath();
			ctx.arc(cx, cy, 6, 0, Math.PI * 2);
			ctx.fillStyle = '#ef4444';
			ctx.strokeStyle = '#fff';
			ctx.lineWidth = 1.5;
			ctx.fill();
			ctx.stroke();
			// label
			if (id) {
				ctx.fillStyle = 'rgba(255,255,255,0.85)';
				ctx.font = 'bold 9px monospace';
				ctx.textAlign = 'center';
				ctx.fillText(id.replace('PED_', '#'), cx, cy - 14);
			}
		});

		// 8. Drone — use SLAM pose if available, else GPS telemetry
		const hasSlamPose = meta && meta.slam_x_mm !== undefined;
		let dcx: number, dcy: number, dyaw: number;
		if (hasSlamPose && meta) {
			[dcx, dcy] = slamPoseToCanvas(meta.slam_x_mm, meta.slam_y_mm, MM, S);
			dyaw = (meta.slam_theta_deg * Math.PI) / 180;
		} else if (dronePos) {
			[dcx, dcy] = worldToCanvas(dronePos.x, dronePos.y, MM, S);
			dyaw = dronePos.yaw ?? 0;
		} else {
			rafRef.current = requestAnimationFrame(draw);
			return;
		}

		// detection radius ring
		const detRadiusPx = (4 / MM) * S;
		ctx.beginPath();
		ctx.arc(dcx, dcy, detRadiusPx, 0, Math.PI * 2);
		ctx.strokeStyle = 'rgba(239,68,68,0.25)';
		ctx.lineWidth = 1;
		ctx.setLineDash([3, 3]);
		ctx.stroke();
		ctx.setLineDash([]);

		// drone body
		ctx.save();
		ctx.translate(dcx, dcy);
		ctx.rotate(-dyaw); // negate: canvas rotates CW, Webots yaw is CCW

		// outer ring
		ctx.beginPath();
		ctx.arc(0, 0, 10, 0, Math.PI * 2);
		ctx.strokeStyle = 'rgba(59,130,246,0.5)';
		ctx.lineWidth = 1.5;
		ctx.stroke();

		// heading arrow
		ctx.strokeStyle = '#93c5fd';
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.moveTo(0, 0);
		ctx.lineTo(0, -13);
		ctx.stroke();

		// filled circle
		ctx.beginPath();
		ctx.arc(0, 0, 6, 0, Math.PI * 2);
		ctx.fillStyle = '#3b82f6';
		ctx.strokeStyle = '#fff';
		ctx.lineWidth = 1.5;
		ctx.fill();
		ctx.stroke();

		ctx.restore();

		rafRef.current = requestAnimationFrame(draw);
	}, [
		size,
		meta,
		dronePos,
		detections,
		allPeds,
		waypoints,
		showSlamMap,
		showAllPeds
	]);

	// Start/restart render loop when draw changes
	useEffect(() => {
		cancelAnimationFrame(rafRef.current);
		rafRef.current = requestAnimationFrame(draw);
		return () => cancelAnimationFrame(rafRef.current);
	}, [draw]);

	// ── Render ──────────────────────────────────────────────────────────────────
	const mapM = meta?.map_meters ?? 40;
	const resM = meta ? (mapM / meta.map_pixels).toFixed(3) : '—';

	return (
		<div className={`flex flex-col gap-3 ${className}`}>
			{/* Header row */}
			<div className="flex items-center justify-between">
				<div>
					<p className="text-xs font-medium tracking-widest text-gray-500 uppercase">
						SLAM grid
					</p>
					<h2 className="mt-0.5 text-lg font-medium text-gray-900 dark:text-gray-100">
						Occupancy map
					</h2>
				</div>
				<div
					className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${
						connected
							? 'border-emerald-400 text-emerald-600 dark:text-emerald-400'
							: 'border-gray-300 text-gray-400'
					}`}
				>
					<span
						className={`h-2 w-2 rounded-full ${
							connected ? 'animate-pulse bg-emerald-400' : 'bg-gray-400'
						}`}
					/>
					{connected ? 'Live' : 'Disconnected'}
				</div>
			</div>

			{/* Canvas */}
			<div
				className="relative overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800"
				style={{ width: size, height: size }}
			>
				<canvas ref={canvasRef} width={size} height={size} className="block" />

				{/* HUD overlay */}
				{meta && (
					<div className="pointer-events-none absolute bottom-3 left-3 rounded-lg bg-black/60 px-2.5 py-2 font-mono text-xs leading-relaxed text-emerald-400">
						<div>
							COV: {mapM}m × {mapM}m
						</div>
						<div>RES: {resM}m/px</div>
						<div>FPS: {lastFps}</div>
						<div>
							POS: {(meta.slam_x_mm / 1000).toFixed(1)},{' '}
							{(meta.slam_y_mm / 1000).toFixed(1)}m
						</div>
					</div>
				)}

				{/* No data placeholder */}
				{!meta && !slamImgRef.current && (
					<div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-gray-600 dark:text-gray-400">
						<svg
							width="32"
							height="32"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.5"
						>
							<path d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2z" />
							<path d="M12 8v4l3 3" />
						</svg>
						<p className="text-sm">Waiting for SLAM data…</p>
					</div>
				)}
			</div>

			{/* Legend */}
			<div className="flex flex-wrap gap-x-5 gap-y-1.5">
				<LegendItem color="#3b82f6" shape="circle" label="Drone (SLAM pose)" />
				<LegendItem color="#22d3ee" shape="dash" label="Flight path" />
				<LegendItem color="#ef4444" shape="circle" label="Detection" />
				{showAllPeds && (
					<LegendItem
						color="rgba(180,180,180,0.4)"
						shape="circle"
						label="Undetected (demo)"
					/>
				)}
			</div>

			{/* Stats row */}
			<div className="grid grid-cols-3 gap-3">
				<StatCard label="Detections" value={detections.length} />
				<StatCard label="Waypoints" value={waypoints.length} />
				<StatCard label="Map frames" value={frameCount} />
			</div>
		</div>
	);
}

// ── Sub-components ────────────────────────────────────────────────────────────
function LegendItem({
	color,
	shape,
	label
}: {
	color: string;
	shape: 'circle' | 'dash';
	label: string;
}) {
	return (
		<div className="flex items-center gap-1.5">
			{shape === 'circle' ? (
				<span
					className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
					style={{ background: color }}
				/>
			) : (
				<span
					className="h-0 w-5 flex-shrink-0"
					style={{ borderTop: `2px dashed ${color}` }}
				/>
			)}
			<span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
		</div>
	);
}

function StatCard({ label, value }: { label: string; value: number }) {
	return (
		<div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-900">
			<p className="mb-1 text-xs text-gray-500 dark:text-gray-400">{label}</p>
			<p className="text-xl font-medium text-gray-900 dark:text-gray-100">
				{value}
			</p>
		</div>
	);
}
