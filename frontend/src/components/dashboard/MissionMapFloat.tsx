'use client';

import { Settings2 } from 'lucide-react';
import FloatingPanel from './FloatingPanel';
import MapCanvas from './MapCanvas';
import { type MapData } from '@/hooks/useMapData';

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
	const dy = typeof window !== 'undefined' ? window.innerHeight - 280 : 500;

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
			width="280px"
		>
			<div className="relative overflow-hidden" style={{ height: 220 }}>
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
			</div>
		</FloatingPanel>
	);
}
