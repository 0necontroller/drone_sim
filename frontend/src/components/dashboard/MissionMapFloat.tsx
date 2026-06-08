'use client';

import { useState } from 'react';
import { Settings2, ZoomIn, ZoomOut } from 'lucide-react';
import FloatingPanel from './FloatingPanel';
import MapCanvas from './MapCanvas';
import { type MapData } from '@/hooks/useMapData';

const ZOOM_STEPS = [1, 1.5, 2, 3, 4];

interface MissionMapFloatProps {
	mapData: MapData;
	onManageMission: () => void;
	defaultX?: number;
	defaultY?: number;
}

export default function MissionMapFloat({
	mapData,
	onManageMission,
	defaultX = 400,
	defaultY,
}: MissionMapFloatProps) {
	const dy = typeof window !== 'undefined' ? window.innerHeight - 290 : 500;
	const [zoomIdx, setZoomIdx] = useState(0);
	const zoom = ZOOM_STEPS[zoomIdx];

	const {
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
		missionActive,
	} = mapData;

	const zoomIn = () => setZoomIdx((i) => Math.min(i + 1, ZOOM_STEPS.length - 1));
	const zoomOut = () => setZoomIdx((i) => Math.max(i - 1, 0));

	const iconBtn =
		'flex h-5 w-5 items-center justify-center rounded-md transition-all active:scale-90 disabled:opacity-30';
	const iconBtnStyle = {
		background: 'rgba(255,255,255,0.08)',
		border: '1px solid rgba(255,255,255,0.14)',
		color: 'rgba(255,255,255,0.7)',
	};

	const headerExtra = (
		<>
			{missionActive && (
				<span
					className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[8px] font-bold uppercase"
					style={{ background: 'rgba(0,255,136,0.12)', border: '1px solid rgba(0,255,136,0.3)', color: '#00ff88' }}
				>
					<span className="h-1 w-1 rounded-full bg-emerald-400 animate-pulse" />
					ACTIVE
				</span>
			)}

			{/* Zoom controls */}
			<button
				onClick={zoomOut}
				disabled={zoomIdx === 0}
				className={iconBtn}
				style={iconBtnStyle}
				title="Zoom out"
			>
				<ZoomOut className="h-3 w-3" />
			</button>
			<span
				className="min-w-[2.2rem] text-center font-mono text-[9px] font-bold"
				style={{ color: 'rgba(0,255,136,0.7)' }}
			>
				{zoom.toFixed(1)}×
			</span>
			<button
				onClick={zoomIn}
				disabled={zoomIdx === ZOOM_STEPS.length - 1}
				className={iconBtn}
				style={iconBtnStyle}
				title="Zoom in"
			>
				<ZoomIn className="h-3 w-3" />
			</button>

			<button
				onClick={onManageMission}
				className="flex items-center gap-1 rounded-lg px-2 py-1 text-[9px] font-semibold transition-all hover:opacity-100 active:scale-95"
				style={{
					background: 'rgba(255,255,255,0.08)',
					border: '1px solid rgba(255,255,255,0.15)',
					color: 'rgba(255,255,255,0.7)',
				}}
			>
				<Settings2 className="h-3 w-3" />
				Manage
			</button>
		</>
	);

	return (
		<FloatingPanel
			title="Mission Map"
			defaultX={defaultX}
			defaultY={defaultY ?? dy}
			headerExtra={headerExtra}
			width="300px"
		>
			<div className="relative overflow-hidden" style={{ height: 240 }}>
				<MapCanvas
					size={400}
					slamImgRef={slamImgRef}
					mapDims={mapDims}
					waypoints={waypoints}
					dronePos={dronePos}
					people={people}
					confirmedDetections={confirmedDetections}
					allPedestrians={allPedestrians}
					polyPoints={polyPoints}
					drawingPoly={drawingPoly}
					supervisorActive={supervisorActive}
					zoom={zoom}
					viewCenter={zoom > 1 ? dronePos : null}
					className="w-full h-full"
				/>
				{/* Waypoint count badge */}
				{waypoints.length > 0 && (
					<div
						className="absolute top-2 right-2 rounded-full px-2 py-0.5 text-[9px] font-bold font-mono"
						style={{ background: 'rgba(0,0,0,0.6)', color: '#00ff88', border: '1px solid rgba(0,255,136,0.3)' }}
					>
						{waypoints.length} WPT
					</div>
				)}
				{/* Zoom-follows-drone indicator */}
				{zoom > 1 && dronePos && (
					<div
						className="absolute bottom-2 left-2 rounded-md px-1.5 py-0.5 text-[8px] font-mono"
						style={{ background: 'rgba(0,0,0,0.55)', color: 'rgba(0,160,255,0.8)', border: '1px solid rgba(0,160,255,0.2)' }}
					>
						FOLLOWING DRONE
					</div>
				)}
			</div>
		</FloatingPanel>
	);
}
