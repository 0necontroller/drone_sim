'use client';

import { useEffect, useRef } from 'react';
import {
	worldToCanvas,
	MAP_SIZE_PX,
	type MapDims,
	type Waypoint,
	type Victim,
	type ConfirmedDetection,
	type AllPedestrian,
} from '@/hooks/useMapData';

interface MapCanvasProps {
	/** Logical canvas resolution (default 500) */
	size?: number;
	slamImgRef: React.MutableRefObject<HTMLImageElement | null>;
	mapDims: MapDims;
	waypoints: Waypoint[];
	dronePos: { x: number; y: number } | null;
	people: Victim[];
	confirmedDetections: ConfirmedDetection[];
	allPedestrians: AllPedestrian[];
	polyPoints: [number, number][];
	drawingPoly: boolean;
	supervisorActive: boolean;
	onClick?: (e: React.MouseEvent<HTMLCanvasElement>) => void;
	className?: string;
}

export default function MapCanvas({
	size = MAP_SIZE_PX,
	slamImgRef,
	mapDims,
	waypoints,
	dronePos,
	people,
	confirmedDetections,
	allPedestrians,
	polyPoints,
	drawingPoly,
	supervisorActive,
	onClick,
	className = '',
}: MapCanvasProps) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		let rafId: number;

		const draw = () => {
			ctx.clearRect(0, 0, size, size);

			// 1. SLAM background
			if (slamImgRef.current) {
				ctx.drawImage(slamImgRef.current, 0, 0, size, size);
			} else {
				ctx.fillStyle = '#0a0f1e';
				ctx.fillRect(0, 0, size, size);
			}

			// 2. Grid lines (5m spacing)
			ctx.strokeStyle = 'rgba(0, 255, 136, 0.06)';
			ctx.lineWidth = 1;
			const gridStep = 5;
			const startX = Math.ceil(mapDims.origin_x / gridStep) * gridStep;
			const startZ = Math.ceil(mapDims.origin_z / gridStep) * gridStep;
			for (let wx = startX; wx <= -mapDims.origin_x; wx += gridStep) {
				const [cx] = worldToCanvas(wx, 0, mapDims, size);
				ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, size); ctx.stroke();
			}
			for (let wz = startZ; wz <= -mapDims.origin_z; wz += gridStep) {
				const [, cy] = worldToCanvas(0, wz, mapDims, size);
				ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(size, cy); ctx.stroke();
			}

			// 3. Planned waypoints + flight path
			if (waypoints.length > 1) {
				ctx.strokeStyle = '#00ff88';
				ctx.lineWidth = 2;
				ctx.setLineDash([6, 4]);
				ctx.beginPath();
				waypoints.forEach((wp, idx) => {
					const [cx, cy] = worldToCanvas(wp.x, wp.y, mapDims, size);
					if (idx === 0) ctx.moveTo(cx, cy);
					else ctx.lineTo(cx, cy);
				});
				ctx.stroke();
				ctx.setLineDash([]);

				waypoints.forEach((wp, idx) => {
					const [cx, cy] = worldToCanvas(wp.x, wp.y, mapDims, size);
					ctx.beginPath();
					ctx.arc(cx, cy, 4, 0, Math.PI * 2);
					ctx.fillStyle = '#00ff88';
					ctx.fill();
					ctx.strokeStyle = '#ffffff';
					ctx.lineWidth = 1;
					ctx.stroke();
					ctx.fillStyle = '#ffffff';
					ctx.font = '9px monospace';
					ctx.textAlign = 'center';
					ctx.fillText((idx + 1).toString(), cx, cy - 8);
				});
			}

			// 4. Poly drawing progress
			if (polyPoints.length > 0) {
				ctx.strokeStyle = '#f59e0b';
				ctx.lineWidth = 2;
				ctx.setLineDash([4, 4]);
				ctx.beginPath();
				polyPoints.forEach(([px, py], idx) => {
					const [cx, cy] = worldToCanvas(px, py, mapDims, size);
					if (idx === 0) ctx.moveTo(cx, cy);
					else ctx.lineTo(cx, cy);
				});
				ctx.stroke();
				ctx.setLineDash([]);
				polyPoints.forEach(([px, py]) => {
					const [cx, cy] = worldToCanvas(px, py, mapDims, size);
					ctx.beginPath();
					ctx.arc(cx, cy, 5, 0, Math.PI * 2);
					ctx.fillStyle = '#f59e0b';
					ctx.fill();
					ctx.strokeStyle = '#ffffff';
					ctx.lineWidth = 1;
					ctx.stroke();
				});
			}

			// 5a. Undetected pedestrians (demo overlay)
			allPedestrians.forEach(({ x, y, detected }) => {
				if (detected) return;
				const [cx, cy] = worldToCanvas(x, y, mapDims, size);
				ctx.beginPath();
				ctx.arc(cx, cy, 4, 0, Math.PI * 2);
				ctx.fillStyle = 'rgba(200, 200, 200, 0.25)';
				ctx.fill();
				ctx.strokeStyle = 'rgba(200, 200, 200, 0.4)';
				ctx.lineWidth = 1;
				ctx.stroke();
			});

			// 5b. Supervisor-confirmed detections
			confirmedDetections.forEach(({ id, x, y }) => {
				const [cx, cy] = worldToCanvas(x, y, mapDims, size);
				const zoneRadius = 4.0 * (size / mapDims.width);
				ctx.beginPath();
				ctx.arc(cx, cy, zoneRadius, 0, Math.PI * 2);
				ctx.fillStyle = 'rgba(239, 68, 68, 0.07)';
				ctx.fill();
				ctx.strokeStyle = 'rgba(239, 68, 68, 0.25)';
				ctx.lineWidth = 1.2;
				ctx.setLineDash([5, 5]);
				ctx.stroke();
				ctx.setLineDash([]);
				const pulseRadius = 11 + Math.sin(Date.now() / 150) * 4;
				ctx.beginPath();
				ctx.arc(cx, cy, pulseRadius, 0, Math.PI * 2);
				ctx.fillStyle = 'rgba(255, 50, 50, 0.2)';
				ctx.fill();
				ctx.beginPath();
				ctx.arc(cx, cy, 6, 0, Math.PI * 2);
				ctx.fillStyle = '#ff3232';
				ctx.fill();
				ctx.strokeStyle = '#ffffff';
				ctx.lineWidth = 1.5;
				ctx.stroke();
				ctx.fillStyle = '#fff';
				ctx.font = 'bold 10px monospace';
				ctx.textAlign = 'center';
				ctx.fillText(id.replace('PED_', '#'), cx, cy - 14);
			});

			// 5c. Geo-projected detections
			people.forEach((person) => {
				const [cx, cy] = worldToCanvas(person.x, person.y, mapDims, size);
				const zoneRadius = 4.0 * (size / mapDims.width);
				ctx.beginPath();
				ctx.arc(cx, cy, zoneRadius, 0, Math.PI * 2);
				ctx.fillStyle = 'rgba(239, 68, 68, 0.08)';
				ctx.fill();
				ctx.strokeStyle = 'rgba(239, 68, 68, 0.3)';
				ctx.lineWidth = 1.2;
				ctx.setLineDash([5, 5]);
				ctx.stroke();
				ctx.setLineDash([]);
				const pulseRadius = 12 + Math.sin(Date.now() / 150) * 4;
				ctx.beginPath();
				ctx.arc(cx, cy, pulseRadius, 0, Math.PI * 2);
				ctx.fillStyle = 'rgba(239, 68, 68, 0.15)';
				ctx.fill();
				ctx.beginPath();
				ctx.arc(cx, cy, 8, 0, Math.PI * 2);
				ctx.fillStyle = 'rgba(239, 68, 68, 0.3)';
				ctx.fill();
				ctx.beginPath();
				ctx.arc(cx, cy, 4, 0, Math.PI * 2);
				ctx.fillStyle = '#ef4444';
				ctx.fill();
				ctx.fillStyle = '#ffffff';
				ctx.font = '11px sans-serif';
				ctx.textAlign = 'center';
				ctx.fillText('👤', cx, cy - 12);
			});

			// 6. Drone marker
			if (dronePos) {
				const [cx, cy] = worldToCanvas(dronePos.x, dronePos.y, mapDims, size);
				ctx.beginPath();
				ctx.arc(cx, cy, 16, 0, Math.PI * 2);
				ctx.strokeStyle = 'rgba(0, 160, 255, 0.3)';
				ctx.lineWidth = 1.5;
				ctx.stroke();
				ctx.beginPath();
				ctx.arc(cx, cy, 7, 0, Math.PI * 2);
				ctx.fillStyle = '#00a0ff';
				ctx.fill();
				ctx.strokeStyle = '#ffffff';
				ctx.lineWidth = 2;
				ctx.stroke();
			}

			// 7. HUD overlay: map info
			ctx.fillStyle = 'rgba(0,0,0,0.55)';
			ctx.fillRect(4, size - 44, 160, 40);
			ctx.fillStyle = '#00ff88';
			ctx.font = '9px monospace';
			ctx.textAlign = 'left';
			ctx.fillText(`COV ${mapDims.width.toFixed(0)}m × ${mapDims.length.toFixed(0)}m`, 10, size - 28);
			ctx.fillText(`RES ${(mapDims.width / size).toFixed(3)}m/px${supervisorActive ? '  SUP ✓' : ''}`, 10, size - 14);

			rafId = requestAnimationFrame(draw);
		};

		rafId = requestAnimationFrame(draw);
		return () => cancelAnimationFrame(rafId);
	}, [waypoints, polyPoints, people, dronePos, mapDims, allPedestrians, confirmedDetections, slamImgRef, supervisorActive, size]);

	return (
		<canvas
			ref={canvasRef}
			width={size}
			height={size}
			className={`block ${drawingPoly ? 'cursor-crosshair' : 'cursor-default'} ${className}`}
			onClick={onClick}
			style={{ width: '100%', height: '100%' }}
		/>
	);
}
