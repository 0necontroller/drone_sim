'use client';

import { useEffect, useRef, useState } from 'react';
import { serverUrl } from '@/lib/config';

export const MAP_SIZE_PX = 500;

export interface MapDims {
	width: number;
	length: number;
	origin_x: number;
	origin_z: number;
}

export interface ConfirmedDetection {
	id: string;
	x: number;
	y: number;
}

export interface AllPedestrian {
	id: string;
	x: number;
	y: number;
	detected: boolean;
}

export interface Victim {
	x: number;
	y: number;
	ts: number;
}

export interface Waypoint {
	x: number;
	y: number;
}

export interface LogEntry {
	id: string;
	type: 'detection' | 'mission_start' | 'mission_complete' | 'abort' | 'waypoints' | 'info';
	message: string;
	timestamp: number;
	data?: { x?: number; y?: number; id?: string };
}

/** Convert Webots world coordinates to canvas pixel coordinates. */
export function worldToCanvas(
	worldX: number,
	worldZ: number,
	mapDims: MapDims,
	size: number,
): [number, number] {
	const scaleX = size / mapDims.width;
	const scaleZ = size / mapDims.length;
	const cx = (worldX - mapDims.origin_x) * scaleX;
	const cy = size - (worldZ - mapDims.origin_z) * scaleZ; // flip Z
	return [cx, cy];
}

export interface MapData {
	slamImgRef: React.MutableRefObject<HTMLImageElement | null>;
	people: Victim[];
	waypoints: Waypoint[];
	dronePos: { x: number; y: number } | null;
	drawingPoly: boolean;
	setDrawingPoly: (v: boolean) => void;
	polyPoints: [number, number][];
	setPolyPoints: React.Dispatch<React.SetStateAction<[number, number][]>>;
	missionActive: boolean;
	mapDims: MapDims;
	confirmedDetections: ConfirmedDetection[];
	allPedestrians: AllPedestrian[];
	supervisorActive: boolean;
	missionLog: LogEntry[];
	launchMission: (opts?: { stripWidth?: number }) => Promise<void>;
	stopMission: () => Promise<void>;
	handleCanvasClick: (e: React.MouseEvent<HTMLCanvasElement>, canvasSize?: number) => void;
}

/** Maximum plausible drone jump in one telemetry tick (metres). Larger jumps are rejected as glitches. */
const MAX_JUMP_M = 18;
/** Exponential moving-average alpha for drone position smoothing (0=frozen, 1=raw). */
const EMA_ALPHA = 0.35;

export function useMapData(wsUrl: string | null): MapData {
	const slamImgRef = useRef<HTMLImageElement | null>(null);
	const [people, setPeople] = useState<Victim[]>([]);
	const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
	const [dronePos, setDronePos] = useState<{ x: number; y: number } | null>(null);
	const [drawingPoly, setDrawingPoly] = useState(false);
	const [polyPoints, setPolyPoints] = useState<[number, number][]>([]);
	const [missionActive, setMissionActive] = useState(false);
	const [mapDims, setMapDims] = useState<MapDims>({
		width: 50, length: 50, origin_x: -25, origin_z: -25,
	});
	const [confirmedDetections, setConfirmedDetections] = useState<ConfirmedDetection[]>([]);
	const [allPedestrians, setAllPedestrians] = useState<AllPedestrian[]>([]);
	const [supervisorActive, setSupervisorActive] = useState(false);
	const [missionLog, setMissionLog] = useState<LogEntry[]>([]);

	// Drone position smoothing state (lives outside React to avoid stale closures)
	const smoothedDronePos = useRef<{ x: number; y: number } | null>(null);
	// Track which detection IDs we've already logged
	const knownDetectionIds = useRef<Set<string>>(new Set());

	/** Append a log entry (newest-first, capped at 100). */
	const addLog = useRef((entry: Omit<LogEntry, 'id' | 'timestamp'>) => {
		setMissionLog((prev) => [
			{
				...entry,
				id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
				timestamp: Date.now(),
			},
			...prev,
		].slice(0, 100));
	});

	/** Apply outlier rejection + EMA smoothing to a raw drone position. */
	const acceptDronePos = useRef((raw: { x: number; y: number }) => {
		const last = smoothedDronePos.current;
		if (last) {
			const dx = raw.x - last.x;
			const dy = raw.y - last.y;
			const dist = Math.sqrt(dx * dx + dy * dy);
			if (dist > MAX_JUMP_M) return; // reject glitch
			// EMA smooth
			const smoothed = {
				x: last.x * (1 - EMA_ALPHA) + raw.x * EMA_ALPHA,
				y: last.y * (1 - EMA_ALPHA) + raw.y * EMA_ALPHA,
			};
			smoothedDronePos.current = smoothed;
			setDronePos({ ...smoothed });
		} else {
			// First reading — accept as-is
			smoothedDronePos.current = { ...raw };
			setDronePos({ ...raw });
		}
	});

	useEffect(() => {
		if (!wsUrl) return;
		const ws = new WebSocket(wsUrl);

		ws.onmessage = (event) => {
			try {
				const msg = JSON.parse(event.data);

				if (msg.type === 'slam_update') {
					const img = new Image();
					img.onload = () => { slamImgRef.current = img; };
					img.src = `data:image/png;base64,${msg.map_b64}`;

				} else if (msg.type === 'detections') {
					setPeople(msg.people || []);

				} else if (msg.type === 'flight_plan') {
					const wps = (msg.waypoints || []).map((wp: number[]) => ({ x: wp[0], y: wp[1] }));
					setWaypoints(wps);
					setMissionActive(true);
					addLog.current({ type: 'waypoints', message: `Flight plan loaded — ${wps.length} waypoints` });

				} else if (msg.type === 'telemetry') {
					const d = msg.data || msg;
					if (typeof d.x === 'number' && typeof d.y === 'number') {
						acceptDronePos.current({ x: d.x, y: d.y });
					}

				} else if (msg.type === 'mission_complete') {
					setMissionActive(false);
					setWaypoints([]);
					addLog.current({ type: 'mission_complete', message: 'Mission complete — all waypoints visited' });

				} else if (msg.type === 'supervisor_state') {
					if (msg.map) setMapDims(msg.map);
					if (msg.all_pedestrians) setAllPedestrians(msg.all_pedestrians);
					if (msg.drone) acceptDronePos.current(msg.drone);
					if (!supervisorActive) setSupervisorActive(true);

					// Detect new confirmed detections and log them
					if (msg.confirmed_detections) {
						const dets: ConfirmedDetection[] = msg.confirmed_detections;
						dets.forEach((det) => {
							if (!knownDetectionIds.current.has(det.id)) {
								knownDetectionIds.current.add(det.id);
								addLog.current({
									type: 'detection',
									message: `Human detected — ${det.id.replace('PED_', 'Target #')}`,
									data: { x: det.x, y: det.y, id: det.id },
								});
							}
						});
						setConfirmedDetections(dets);
					}
				}
			} catch {
				// ignore malformed payloads
			}
		};

		return () => ws.close();
	}, [wsUrl, supervisorActive]);

	const launchMission = async (opts?: { stripWidth?: number }) => {
		if (polyPoints.length < 3) {
			alert('Please define search boundaries by plotting at least 3 points.');
			return;
		}
		try {
			const sw = opts?.stripWidth ?? 10.0;
			const res = await fetch(`${serverUrl}/api/v1/drone/plan_flight`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					polygon: polyPoints,
					altitude: 11.0,
					strip_width: sw,
					coordinate_type: 'meters',
				}),
			});
			if (!res.ok) throw new Error('API server rejected flight path planning');
			const data = await res.json();
			const wps = (data.waypoints || []).map((wp: number[]) => ({ x: wp[0], y: wp[1] }));
			setWaypoints(wps);
			setDrawingPoly(false);
			setPolyPoints([]);
			setMissionActive(true);
			addLog.current({
				type: 'mission_start',
				message: `Search launched — ${wps.length} waypoints @ ${sw}m strip`,
			});
		} catch {
			alert('Failed to transmit flight plan coordinates.');
		}
	};

	const stopMission = async () => {
		try {
			const res = await fetch(`${serverUrl}/api/v1/drone/stop_autonomous`, { method: 'POST' });
			if (res.ok) {
				setMissionActive(false);
				setWaypoints([]);
				addLog.current({ type: 'abort', message: 'Mission aborted — returning to hover' });
			}
		} catch {
			// ignore
		}
	};

	const handleCanvasClick = (
		e: React.MouseEvent<HTMLCanvasElement>,
		canvasSize: number = MAP_SIZE_PX,
	) => {
		if (!drawingPoly) return;
		const canvas = e.currentTarget;
		const rect = canvas.getBoundingClientRect();
		const cx = (e.clientX - rect.left) * (canvasSize / rect.width);
		const cy = (e.clientY - rect.top) * (canvasSize / rect.height);
		const scaleX = canvasSize / mapDims.width;
		const scaleZ = canvasSize / mapDims.length;
		const wx = cx / scaleX + mapDims.origin_x;
		const wy = (canvasSize - cy) / scaleZ + mapDims.origin_z;
		setPolyPoints((prev) => [...prev, [wx, wy]]);
	};

	return {
		slamImgRef,
		people,
		waypoints,
		dronePos,
		drawingPoly,
		setDrawingPoly,
		polyPoints,
		setPolyPoints,
		missionActive,
		mapDims,
		confirmedDetections,
		allPedestrians,
		supervisorActive,
		missionLog,
		launchMission,
		stopMission,
		handleCanvasClick,
	};
}
