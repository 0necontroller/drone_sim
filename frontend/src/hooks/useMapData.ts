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
	launchMission: () => Promise<void>;
	stopMission: () => Promise<void>;
	handleCanvasClick: (e: React.MouseEvent<HTMLCanvasElement>, canvasSize?: number) => void;
}

export function useMapData(wsUrl: string | null): MapData {
	const slamImgRef = useRef<HTMLImageElement | null>(null);
	const [people, setPeople] = useState<Victim[]>([]);
	const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
	const [dronePos, setDronePos] = useState<{ x: number; y: number } | null>(null);
	const [drawingPoly, setDrawingPoly] = useState(false);
	const [polyPoints, setPolyPoints] = useState<[number, number][]>([]);
	const [missionActive, setMissionActive] = useState(false);
	const [mapDims, setMapDims] = useState<MapDims>({
		width: 50,
		length: 50,
		origin_x: -25,
		origin_z: -25,
	});
	const [confirmedDetections, setConfirmedDetections] = useState<ConfirmedDetection[]>([]);
	const [allPedestrians, setAllPedestrians] = useState<AllPedestrian[]>([]);
	const [supervisorActive, setSupervisorActive] = useState(false);

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
				} else if (msg.type === 'telemetry') {
					const d = msg.data || msg;
					if (typeof d.x === 'number' && typeof d.y === 'number') {
						setDronePos({ x: d.x, y: d.y });
					}
				} else if (msg.type === 'mission_complete') {
					setMissionActive(false);
					setWaypoints([]);
				} else if (msg.type === 'supervisor_state') {
					if (msg.map) setMapDims(msg.map);
					if (msg.confirmed_detections) setConfirmedDetections(msg.confirmed_detections);
					if (msg.all_pedestrians) setAllPedestrians(msg.all_pedestrians);
					if (msg.drone) setDronePos(msg.drone);
					if (!supervisorActive) setSupervisorActive(true);
				}
			} catch {
				// ignore malformed payloads
			}
		};

		return () => ws.close();
	}, [wsUrl, supervisorActive]);

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
		// Scale click position from display coords to canvas coords
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
		launchMission,
		stopMission,
		handleCanvasClick,
	};
}
