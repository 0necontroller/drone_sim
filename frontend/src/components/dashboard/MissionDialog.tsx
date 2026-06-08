'use client';

import { useState } from 'react';
import { Radar, Play, Ban, X, MapPin, RotateCcw } from 'lucide-react';
import MapCanvas from './MapCanvas';
import { type MapData } from '@/hooks/useMapData';

interface MissionDialogProps {
	mapData: MapData;
	onClose: () => void;
}

export default function MissionDialog({ mapData, onClose }: MissionDialogProps) {
	const {
		slamImgRef,
		mapDims,
		waypoints,
		dronePos,
		people,
		confirmedDetections,
		allPedestrians,
		polyPoints,
		setPolyPoints,
		drawingPoly,
		setDrawingPoly,
		supervisorActive,
		missionActive,
		launchMission,
		stopMission,
		handleCanvasClick,
	} = mapData;

	const [stripWidth, setStripWidth] = useState(10);

	const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
		handleCanvasClick(e, 600);
	};

	return (
		/* Backdrop */
		<div
			className="fixed inset-0 z-50 flex items-center justify-center"
			style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
			onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
		>
			{/* Dialog */}
			<div
				className="relative flex flex-col rounded-3xl overflow-hidden shadow-2xl"
				style={{
					width: 'min(900px, 95vw)',
					maxHeight: '90vh',
					background: 'rgba(6,10,22,0.95)',
					border: '1px solid rgba(0,255,136,0.2)',
					boxShadow: '0 0 60px rgba(0,255,136,0.08), 0 40px 80px rgba(0,0,0,0.8)',
				}}
			>
				{/* Header */}
				<div
					className="flex items-center justify-between px-6 py-4"
					style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}
				>
					<div className="flex items-center gap-3">
						<div
							className="flex h-8 w-8 items-center justify-center rounded-lg"
							style={{ background: 'rgba(0,255,136,0.12)', border: '1px solid rgba(0,255,136,0.25)' }}
						>
							<Radar className="h-4 w-4" style={{ color: '#00ff88' }} />
						</div>
						<div>
							<p className="text-[9px] font-bold tracking-[0.3em] uppercase" style={{ color: 'rgba(0,255,136,0.6)' }}>
								Mission Control
							</p>
							<h2 className="text-base font-semibold text-white leading-tight">
								Search Zone Planning
							</h2>
						</div>
						{missionActive && (
							<span
								className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-bold uppercase"
								style={{ background: 'rgba(0,255,136,0.12)', border: '1px solid rgba(0,255,136,0.3)', color: '#00ff88' }}
							>
								<span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
								Mission Active
							</span>
						)}
					</div>
					<button
						onClick={onClose}
						className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
						style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
					>
						<X className="h-4 w-4 text-white/60" />
					</button>
				</div>

				{/* Body */}
				<div className="flex flex-1 min-h-0 overflow-hidden">
					{/* Map Canvas */}
					<div className="relative flex-1 overflow-hidden bg-slate-950">
						<MapCanvas
							size={600}
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
							onClick={handleClick}
							className="w-full h-full"
						/>
						{drawingPoly && (
							<div
								className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-semibold"
								style={{ background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.4)', color: '#f59e0b' }}
							>
								<MapPin className="h-3 w-3" />
								Click to place boundary points · {polyPoints.length} placed
							</div>
						)}
					</div>

					{/* Controls Panel */}
					<div
						className="flex w-64 shrink-0 flex-col gap-4 p-5 overflow-y-auto"
						style={{ borderLeft: '1px solid rgba(255,255,255,0.07)' }}
					>
						{/* Draw zone */}
						<div className="flex flex-col gap-2">
							<p className="text-[9px] font-bold tracking-[0.25em] uppercase" style={{ color: 'rgba(255,255,255,0.35)' }}>
								Define Zone
							</p>
							<button
								type="button"
								onClick={() => {
									setDrawingPoly(!drawingPoly);
									setPolyPoints([]);
								}}
								className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all active:scale-95"
								style={
									drawingPoly
										? { background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.4)', color: '#f59e0b' }
										: { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.8)' }
								}
							>
								<Radar className="h-4 w-4" />
								{drawingPoly ? 'Cancel Draw' : 'Draw Search Zone'}
							</button>

							{polyPoints.length > 0 && (
								<button
									type="button"
									onClick={() => setPolyPoints([])}
									className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2 text-xs font-medium transition-all active:scale-95"
									style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.5)' }}
								>
									<RotateCcw className="h-3 w-3" />
									Clear Points ({polyPoints.length})
								</button>
							)}
						</div>

						{/* Point list */}
						{polyPoints.length > 0 && (
							<div className="flex flex-col gap-1.5">
								<p className="text-[9px] font-bold tracking-[0.25em] uppercase" style={{ color: 'rgba(255,255,255,0.35)' }}>
									Boundary Points
								</p>
								<div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
									{polyPoints.map(([x, y], i) => (
										<div
											key={i}
											className="flex items-center justify-between rounded-lg px-2.5 py-1.5 font-mono text-[10px]"
											style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.15)', color: 'rgba(245,158,11,0.8)' }}
										>
											<span className="font-bold">{i + 1}</span>
											<span>{x.toFixed(1)}m, {y.toFixed(1)}m</span>
										</div>
									))}
								</div>
							</div>
						)}

						{/* Separator */}
						<div className="h-px" style={{ background: 'rgba(255,255,255,0.07)' }} />

						{/* Strip Width */}
						<div className="flex flex-col gap-2">
							<div className="flex items-center justify-between">
								<p className="text-[9px] font-bold tracking-[0.25em] uppercase" style={{ color: 'rgba(255,255,255,0.35)' }}>
									Strip Width
								</p>
								<span className="font-mono text-xs font-bold" style={{ color: '#00ff88' }}>
									{stripWidth}m
								</span>
							</div>
							<input
								type="range"
								min={5}
								max={20}
								step={1}
								value={stripWidth}
								onChange={(e) => setStripWidth(Number(e.target.value))}
								className="w-full accent-emerald-400"
								style={{ accentColor: '#00ff88' }}
							/>
							<div className="flex justify-between text-[8px] font-mono" style={{ color: 'rgba(255,255,255,0.25)' }}>
								<span>5m (dense)</span>
								<span>20m (sparse)</span>
							</div>
						</div>

						{/* Separator */}
						<div className="h-px" style={{ background: 'rgba(255,255,255,0.07)' }} />

						{/* Launch */}
						<div className="flex flex-col gap-2">
							<p className="text-[9px] font-bold tracking-[0.25em] uppercase" style={{ color: 'rgba(255,255,255,0.35)' }}>
								Mission
							</p>
							<button
								type="button"
								onClick={() => launchMission({ stripWidth })}
								disabled={polyPoints.length < 3 || missionActive}
								className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
								style={{
									background: polyPoints.length >= 3 && !missionActive
										? 'linear-gradient(135deg, rgba(0,255,136,0.25), rgba(0,180,100,0.15))'
										: 'rgba(255,255,255,0.04)',
									border: polyPoints.length >= 3 && !missionActive
										? '1px solid rgba(0,255,136,0.4)'
										: '1px solid rgba(255,255,255,0.08)',
									color: polyPoints.length >= 3 && !missionActive ? '#00ff88' : 'rgba(255,255,255,0.4)',
								}}
							>
								<Play className="h-4 w-4" />
								Launch Search
							</button>

							<button
								type="button"
								onClick={stopMission}
								className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all active:scale-95"
								style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#ef4444' }}
							>
								<Ban className="h-4 w-4" />
								Abort / Hover
							</button>
						</div>

						{/* Legend */}
						<div className="mt-auto flex flex-col gap-1.5 pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
							<p className="text-[9px] font-bold tracking-[0.25em] uppercase mb-1" style={{ color: 'rgba(255,255,255,0.3)' }}>
								Legend
							</p>
							{[
								{ color: '#00a0ff', label: 'Drone Position' },
								{ color: '#00ff88', label: 'Waypath' },
								{ color: '#ef4444', label: 'Detection' },
								{ color: '#f59e0b', label: 'Drawing Poly' },
							].map(({ color, label }) => (
								<div key={label} className="flex items-center gap-2 text-[10px]" style={{ color: 'rgba(255,255,255,0.45)' }}>
									<span className="h-2 w-2 rounded-full shrink-0" style={{ background: color }} />
									{label}
								</div>
							))}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
