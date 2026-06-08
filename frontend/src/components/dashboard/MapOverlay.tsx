'use client';

import { useEffect, useRef, useState } from 'react';
import { serverUrl } from '@/lib/config';
import { headingFont } from '@/lib/fonts';
import { Radar, Target, Play, Ban, ShieldAlert, CircleDot } from 'lucide-react';

const MAP_SIZE_PX = 500; // Display dimensions of the canvas
const MAP_METERS = 40.0; // Must match backend SLAM_MAP_METERS

// Helper to convert Webots world coordinates (meters) to canvas pixel coordinates
function worldToCanvas(x: number, y: number) {
	const scale = MAP_SIZE_PX / MAP_METERS;
	return [
		MAP_SIZE_PX / 2 + x * scale,
		MAP_SIZE_PX / 2 - y * scale // Flip Y axis because canvas draws downwards
	];
}

interface Victim {
	x: number;
	y: number;
	ts: number;
}

interface Waypoint {
	x: number;
	y: number;
}

interface MapOverlayProps {
	wsUrl: string | null;
}

export default function MapOverlay({ wsUrl }: MapOverlayProps) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const slamImgRef = useRef<HTMLImageElement | null>(null);
	const [people, setPeople] = useState<Victim[]>([]);
	const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
	const [dronePos, setDronePos] = useState<{ x: number; y: number } | null>(
		null
	);
	const [drawingPoly, setDrawingPoly] = useState(false);
	const [polyPoints, setPolyPoints] = useState<[number, number][]>([]);
	const [missionActive, setMissionActive] = useState(false);

	// WebSocket handler for map messages
	useEffect(() => {
		if (!wsUrl) return;

		const ws = new WebSocket(wsUrl);

		ws.onmessage = (event) => {
			try {
				const msg = JSON.parse(event.data);
				if (msg.type === 'slam_update') {
					const img = new Image();
					img.onload = () => {
						slamImgRef.current = img;
					};
					img.src = `data:image/png;base64,${msg.map_b64}`;
				} else if (msg.type === 'detections') {
					setPeople(msg.people || []);
				} else if (msg.type === 'flight_plan') {
					const wps = (msg.waypoints || []).map((wp: number[]) => ({
						x: wp[0],
						y: wp[1]
					}));
					setWaypoints(wps);
					setMissionActive(true);
				} else if (msg.type === 'telemetry') {
					const d = msg.data || msg;
					if (typeof d.x === 'number' && typeof d.y === 'number') {
						setDronePos({ x: d.x, y: d.y });
					}
				} else if (msg.type === 'mission_complete') {
					setMissionActive(false);
					setWaypoints([]);
				}
			} catch (_err) {
				// ignore malformed payloads
			}
		};

		return () => {
			ws.close();
		};
	}, [wsUrl]);

	// Render loop
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		let rafId: number;

		const draw = () => {
			ctx.clearRect(0, 0, MAP_SIZE_PX, MAP_SIZE_PX);

			// 1. Draw SLAM Background
			if (slamImgRef.current) {
				ctx.drawImage(slamImgRef.current, 0, 0, MAP_SIZE_PX, MAP_SIZE_PX);
			} else {
				// Gritty slate background matching radar look
				ctx.fillStyle = '#0f172a';
				ctx.fillRect(0, 0, MAP_SIZE_PX, MAP_SIZE_PX);
			}

			// 2. Draw 5-meter Reference Grid Lines
			ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
			ctx.lineWidth = 1;
			for (let m = -20; m <= 20; m += 5) {
				const [cx] = worldToCanvas(m, 0);
				const [, cy] = worldToCanvas(0, m);

				ctx.beginPath();
				ctx.moveTo(cx, 0);
				ctx.lineTo(cx, MAP_SIZE_PX);
				ctx.stroke();

				ctx.beginPath();
				ctx.moveTo(0, cy);
				ctx.lineTo(MAP_SIZE_PX, cy);
				ctx.stroke();
			}

			// 3. Draw Planned Waypoints (Dashed Flight Path)
			if (waypoints.length > 1) {
				ctx.strokeStyle = '#10b981'; // emerald green path
				ctx.lineWidth = 2;
				ctx.setLineDash([6, 4]);
				ctx.beginPath();
				waypoints.forEach((wp, idx) => {
					const [cx, cy] = worldToCanvas(wp.x, wp.y);
					if (idx === 0) ctx.moveTo(cx, cy);
					else ctx.lineTo(cx, cy);
				});
				ctx.stroke();
				ctx.setLineDash([]);

				// Waypoint dots
				waypoints.forEach((wp, idx) => {
					const [cx, cy] = worldToCanvas(wp.x, wp.y);
					ctx.beginPath();
					ctx.arc(cx, cy, 4, 0, Math.PI * 2);
					ctx.fillStyle = '#10b981';
					ctx.fill();
					ctx.strokeStyle = '#ffffff';
					ctx.lineWidth = 1;
					ctx.stroke();

					// Label waypoint index
					ctx.fillStyle = '#ffffff';
					ctx.font = '9px monospace';
					ctx.textAlign = 'center';
					ctx.fillText((idx + 1).toString(), cx, cy - 8);
				});
			}

			// 4. Draw Polyline Drawing progress
			if (polyPoints.length > 0) {
				ctx.strokeStyle = '#eab308'; // Amber drawing line
				ctx.lineWidth = 2;
				ctx.setLineDash([4, 4]);
				ctx.beginPath();
				polyPoints.forEach(([px, py], idx) => {
					const [cx, cy] = worldToCanvas(px, py);
					if (idx === 0) ctx.moveTo(cx, cy);
					else ctx.lineTo(cx, cy);
				});
				ctx.stroke();
				ctx.setLineDash([]);

				polyPoints.forEach(([px, py]) => {
					const [cx, cy] = worldToCanvas(px, py);
					ctx.beginPath();
					ctx.arc(cx, cy, 5, 0, Math.PI * 2);
					ctx.fillStyle = '#eab308';
					ctx.fill();
					ctx.strokeStyle = '#ffffff';
					ctx.lineWidth = 1;
					ctx.stroke();
				});
			}

			// 5. Draw Detected Stranded Individuals
			people.forEach((person) => {
				const [cx, cy] = worldToCanvas(person.x, person.y);

				// 4.0-meter Safety/Detection Zone Circle (Euclidean)
				const zoneRadius = 4.0 * (MAP_SIZE_PX / MAP_METERS);
				ctx.beginPath();
				ctx.arc(cx, cy, zoneRadius, 0, Math.PI * 2);
				ctx.fillStyle = 'rgba(239, 68, 68, 0.08)'; // Shaded zone
				ctx.fill();
				ctx.strokeStyle = 'rgba(239, 68, 68, 0.3)';
				ctx.lineWidth = 1.2;
				ctx.setLineDash([5, 5]); // Dashed border indicating zone boundary
				ctx.stroke();
				ctx.setLineDash([]); // Reset line dash

				// Pulsing radar target halo
				const pulseRadius = 12 + Math.sin(Date.now() / 150) * 4;
				ctx.beginPath();
				ctx.arc(cx, cy, pulseRadius, 0, Math.PI * 2);
				ctx.fillStyle = 'rgba(239, 68, 68, 0.15)'; // Red translucent pulse
				ctx.fill();

				// Base glow ring
				ctx.beginPath();
				ctx.arc(cx, cy, 8, 0, Math.PI * 2);
				ctx.fillStyle = 'rgba(239, 68, 68, 0.3)';
				ctx.fill();

				// Core marker
				ctx.beginPath();
				ctx.arc(cx, cy, 4, 0, Math.PI * 2);
				ctx.fillStyle = '#ef4444'; // Bright red
				ctx.fill();

				// Icon label
				ctx.fillStyle = '#ffffff';
				ctx.font = '11px sans-serif';
				ctx.textAlign = 'center';
				ctx.fillText('👤', cx, cy - 12);
			});

			// 6. Draw Drone Location Marker
			if (dronePos) {
				const [cx, cy] = worldToCanvas(dronePos.x, dronePos.y);

				// Outer scanner ring
				ctx.beginPath();
				ctx.arc(cx, cy, 14, 0, Math.PI * 2);
				ctx.strokeStyle = 'rgba(59, 130, 246, 0.3)'; // transparent blue
				ctx.lineWidth = 1.5;
				ctx.stroke();

				// Drone core dot
				ctx.beginPath();
				ctx.arc(cx, cy, 7, 0, Math.PI * 2);
				ctx.fillStyle = '#3b82f6'; // vivid blue
				ctx.fill();
				ctx.strokeStyle = '#ffffff';
				ctx.lineWidth = 2;
				ctx.stroke();
			}

			rafId = requestAnimationFrame(draw);
		};

		rafId = requestAnimationFrame(draw);
		return () => cancelAnimationFrame(rafId);
	}, [waypoints, polyPoints, people, dronePos]);

	// Handle drawing clicks
	const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
		if (!drawingPoly) return;
		const canvas = canvasRef.current;
		if (!canvas) return;
		const rect = canvas.getBoundingClientRect();
		const cx = e.clientX - rect.left;
		const cy = e.clientY - rect.top;

		// Convert pixel back to world metres
		const scale = MAP_METERS / MAP_SIZE_PX;
		const wx = (cx - MAP_SIZE_PX / 2) * scale;
		const wy = -(cy - MAP_SIZE_PX / 2) * scale;

		setPolyPoints((prev) => [...prev, [wx, wy]]);
	};

	// POST coordinates to launch search mission
	const launchMission = async () => {
		if (polyPoints.length < 3) {
			alert('Please define search boundaries by plotting at least 3 points.');
			return;
		}

		try {
			const res = await fetch(`${serverUrl}/api/v1/drone/plan_flight`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					polygon: polyPoints,
					altitude: 6.0,
					strip_width: 5.0,
					coordinate_type: 'meters'
				})
			});
			if (!res.ok) throw new Error('API server rejected flight path planning');
			const data = await res.json();
			const wps = (data.waypoints || []).map((wp: number[]) => ({
				x: wp[0],
				y: wp[1]
			}));
			setWaypoints(wps);
			setDrawingPoly(false);
			setPolyPoints([]);
			setMissionActive(true);
		} catch (_err) {
			alert('Failed to transmit flight plan coordinates.');
		}
	};

	// POST to abort mission
	const stopMission = async () => {
		try {
			const res = await fetch(`${serverUrl}/api/v1/drone/stop_autonomous`, {
				method: 'POST'
			});
			if (res.ok) {
				setMissionActive(false);
				setWaypoints([]);
			}
		} catch (_err) {
			// ignore abort endpoint failures
		}
	};

	return (
		<div className="flex flex-col gap-6 lg:flex-row">
			{/* Left: Map Display */}
			<div className="relative rounded-3xl border border-gray-100 bg-white p-6 shadow-sm flex-1 flex flex-col items-center justify-center">
				<div className="mb-4 flex w-full flex-row items-center justify-between">
					<div className="flex flex-col gap-1">
						<p className="text-xs font-semibold tracking-[0.2em] text-gray-400 uppercase">
							SLAM Grid
						</p>
						<h2 className={`${headingFont.className} text-2xl text-gray-900`}>
							Tactical Operations Map
						</h2>
					</div>
					{/* Status badge */}
					<div className="flex items-center gap-2">
						{missionActive ? (
							<span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-600 shadow-sm border border-emerald-100">
								<span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
								AUTONOMOUS SEARCH
							</span>
						) : (
							<span className="flex items-center gap-1.5 rounded-full bg-gray-50 px-3 py-1 text-xs font-semibold text-gray-500 shadow-sm border border-gray-100">
								<span className="h-2 w-2 rounded-full bg-gray-400" />
								STANDBY / MANUAL
							</span>
						)}
					</div>
				</div>

				{/* Canvas */}
				<div className="relative overflow-hidden rounded-2xl border border-gray-150 bg-slate-900 shadow-inner">
					<canvas
						ref={canvasRef}
						width={MAP_SIZE_PX}
						height={MAP_SIZE_PX}
						className={`block ${drawingPoly ? 'cursor-crosshair' : 'cursor-default'}`}
						onClick={handleCanvasClick}
					/>

					{/* Simple HUD stats */}
					<div className="absolute bottom-3 left-3 rounded-lg bg-slate-950/70 p-2 font-mono text-[10px] text-emerald-400 backdrop-blur-xs border border-emerald-500/20">
						<div>COV: 40m x 40m</div>
						<div>RES: 0.05m/px</div>
					</div>
				</div>

				{/* Map Legend */}
				<div className="mt-4 flex flex-wrap gap-4 text-xs text-gray-500">
					<span className="flex items-center gap-1.5">
						<CircleDot className="h-4 w-4 text-blue-500" />
						Drone Position
					</span>
					<span className="flex items-center gap-1.5">
						<Target className="h-4 w-4 text-emerald-500" />
						Lawnmower Waypath
					</span>
					<span className="flex items-center gap-1.5">
						<ShieldAlert className="h-4 w-4 text-red-500" />
						Detected Victim
					</span>
					<span className="flex items-center gap-1.5">
						<span className="h-3 w-3 rounded-full bg-red-50 border border-red-300 border-dashed" />
						Detection Zone (4m)
					</span>
				</div>
			</div>

			{/* Right: Operational Panel */}
			<div className="w-full lg:w-96 shrink-0 flex flex-col gap-6">
				{/* Mission Control Card */}
				<div className="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm flex flex-col gap-4">
					<p className="text-xs font-semibold tracking-[0.2em] text-gray-400 uppercase">
						Missions
					</p>
					<h3 className={`${headingFont.className} text-xl text-gray-900`}>
						Search Planning
					</h3>

					<div className="flex flex-col gap-3">
						<button
							type="button"
							onClick={() => {
								setDrawingPoly((d) => !d);
								setPolyPoints([]);
							}}
							className={`flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium transition-all active:scale-98 ${
								drawingPoly
									? 'border-yellow-300 bg-yellow-50 text-yellow-800'
									: 'border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100 hover:border-gray-300'
							}`}
						>
							<Radar className="h-4 w-4" />
							{drawingPoly ? 'Cancel Draw Mode' : 'Define Search Zone'}
						</button>

						{drawingPoly && (
							<p className="text-xs text-yellow-600 bg-yellow-50/50 p-2.5 rounded-lg border border-yellow-100 text-center animate-fade-in">
								Click coordinates on the tactical screen to define a search
								polygon bounds.
							</p>
						)}

						<button
							type="button"
							onClick={launchMission}
							disabled={polyPoints.length < 3 || missionActive}
							className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-sm transition-all active:scale-98 ${
								polyPoints.length >= 3 && !missionActive
									? 'bg-emerald-600 hover:bg-emerald-700 hover:shadow-md cursor-pointer'
									: 'bg-emerald-300 cursor-not-allowed opacity-60'
							}`}
						>
							<Play className="h-4 w-4" />
							Launch Autonomous Search
						</button>

						<button
							type="button"
							onClick={stopMission}
							className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-600 shadow-sm transition-all hover:bg-red-100 hover:border-red-300 active:scale-98"
						>
							<Ban className="h-4 w-4" />
							Abort / Hold Hover
						</button>
					</div>
				</div>

				{/* Victim Log Card */}
				<div className="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm flex-1 flex flex-col min-h-[200px]">
					<div className="mb-4 flex items-center justify-between">
						<div>
							<p className="text-xs font-semibold tracking-[0.2em] text-gray-400 uppercase">
								Log
							</p>
							<h3 className={`${headingFont.className} text-xl text-gray-900`}>
								Identified Victims
							</h3>
						</div>
						<span className="rounded-full bg-red-50 border border-red-100 px-2.5 py-0.5 text-xs font-bold text-red-600 animate-pulse">
							{people.length} Found
						</span>
					</div>

					<div className="flex-1 overflow-y-auto max-h-[220px] pr-1 flex flex-col gap-2">
						{people.length === 0 ? (
							<div className="flex h-full flex-col items-center justify-center text-center p-4">
								<span className="text-3xl mb-2">🔭</span>
								<p className="text-xs text-gray-400">
									No detections logged. Launch autonomous search loop.
								</p>
							</div>
						) : (
							people.map((person) => (
								<div
									key={`${person.x}-${person.y}-${person.ts}`}
									className="flex items-center justify-between rounded-xl border border-red-50 bg-red-50/30 p-3 text-xs"
								>
									<div className="flex items-center gap-2.5">
										<span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-100 text-[10px] font-bold text-red-600">
											👤
										</span>
										<div className="flex flex-col">
											<span className="font-mono text-gray-700">
												X: {person.x.toFixed(2)}m
											</span>
											<span className="font-mono text-gray-750">
												Y: {person.y.toFixed(2)}m
											</span>
										</div>
									</div>
									<span className="text-[10px] text-gray-400">
										{new Date(person.ts * 1000).toLocaleTimeString([], {
											hour: '2-digit',
											minute: '2-digit',
											second: '2-digit'
										})}
									</span>
								</div>
							))
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
