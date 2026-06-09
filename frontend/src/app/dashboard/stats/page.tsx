'use client';

import { useEffect, useState } from 'react';
import { Target, AlertTriangle, CheckCircle, Navigation, Crosshair, ArrowLeft } from 'lucide-react';
import { serverUrl } from '@/lib/config';
import { headingFont } from '@/lib/fonts';
import MapCanvas from '@/components/dashboard/MapCanvas';
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle
} from '@/components/ui/dialog';

interface Detection {
	id: number;
	mission_id: number;
	timestamp: number;
	x: number;
	y: number;
	radius: number;
	dispatched: boolean;
	status: string;
}

interface Mission {
	id: number;
	start_time: number;
	end_time: number;
	status: string;
}

export default function StatsDashboard() {
	const [detections, setDetections] = useState<Detection[]>([]);
	const [missions, setMissions] = useState<Mission[]>([]);
	const [selectedDetection, setSelectedDetection] = useState<Detection | null>(
		null
	);

	// Static map sizing for the 400m Webots world
	const mapDims = {
		width: 400,
		length: 400,
		origin_x: -200,
		origin_z: -200
	};

	const fetchData = async () => {
		try {
			const [detRes, missRes] = await Promise.all([
				fetch(`${serverUrl}/api/v1/stats/detections`),
				fetch(`${serverUrl}/api/v1/stats/missions`)
			]);
			if (detRes.ok) setDetections(await detRes.json());
			if (missRes.ok) setMissions(await missRes.json());
		} catch (e) {
			console.error('Failed to fetch stats', e);
		}
	};

	useEffect(() => {
		fetchData();
		// Poll for live updates every 5 seconds
		const interval = setInterval(fetchData, 5000);
		return () => clearInterval(interval);
	}, []);

	const updateDetectionStatus = async (
		id: number,
		updates: Partial<Detection>
	) => {
		try {
			const res = await fetch(`${serverUrl}/api/v1/stats/detections/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(updates)
			});
			if (res.ok) {
				const updated = await res.json();
				setDetections((prev) => prev.map((d) => (d.id === id ? updated : d)));
				if (selectedDetection?.id === id) setSelectedDetection(updated);
			}
		} catch (e) {
			console.error('Failed to update detection', e);
		}
	};

	const totalDetections = detections.length;
	const dispatchedCount = detections.filter((d) => d.dispatched).length;
	const rescuedCount = detections.filter((d) => d.status === 'rescued').length;

	return (
		<div
			className="flex h-full flex-col gap-6 bg-gray-950 p-6"
			style={{ color: 'rgba(255,255,255,0.85)' }}
		>
			<div
				className="flex items-end justify-between border-b pb-4"
				style={{ borderColor: 'rgba(255,255,255,0.1)' }}
			>
				<div>
					<button
						onClick={() => (window.location.href = '/dashboard')}
						className="mb-2 flex items-center gap-1.5 text-xs font-bold tracking-widest uppercase transition-all hover:text-white"
						style={{ color: 'rgba(255,255,255,0.6)' }}
					>
						<ArrowLeft className="h-4 w-4" />
						Back to Dashboard
					</button>
					<h1
						className={`text-3xl font-bold tracking-wider ${headingFont.className}`}
						style={{ color: '#00ff88' }}
					>
						MISSION STATS
					</h1>
					<p className="mt-1 font-mono text-xs uppercase tracking-widest opacity-60">
						Live Database Analytics
					</p>
				</div>
			</div>

			<div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
				{/* KPI Cards */}
				<div
					className="flex flex-col justify-center rounded-xl p-6"
					style={{
						background: 'rgba(255,255,255,0.03)',
						border: '1px solid rgba(255,255,255,0.08)'
					}}
				>
					<p className="font-mono text-xs tracking-widest uppercase opacity-60">
						Total Detections
					</p>
					<div className="mt-2 flex items-baseline gap-3">
						<Target className="h-8 w-8 text-amber-500 opacity-80" />
						<span className="font-mono text-4xl font-bold">
							{totalDetections}
						</span>
					</div>
				</div>

				<div
					className="flex flex-col justify-center rounded-xl p-6"
					style={{
						background: 'rgba(255,255,255,0.03)',
						border: '1px solid rgba(255,255,255,0.08)'
					}}
				>
					<p className="font-mono text-xs tracking-widest uppercase opacity-60">
						Dispatched Teams
					</p>
					<div className="mt-2 flex items-baseline gap-3">
						<Navigation className="h-8 w-8 text-blue-500 opacity-80" />
						<span className="font-mono text-4xl font-bold">
							{dispatchedCount}
						</span>
					</div>
				</div>

				<div
					className="flex flex-col justify-center rounded-xl p-6"
					style={{
						background: 'rgba(255,255,255,0.03)',
						border: '1px solid rgba(255,255,255,0.08)'
					}}
				>
					<p className="font-mono text-xs tracking-widest uppercase opacity-60">
						Confirmed Rescues
					</p>
					<div className="mt-2 flex items-baseline gap-3">
						<CheckCircle className="h-8 w-8 text-emerald-500 opacity-80" />
						<span className="font-mono text-4xl font-bold">{rescuedCount}</span>
					</div>
				</div>

				{/* Map View */}
				<div
					className="col-span-1 overflow-hidden rounded-xl lg:col-span-2"
					style={{
						background: 'rgba(255,255,255,0.03)',
						border: '1px solid rgba(255,255,255,0.08)',
						minHeight: '500px'
					}}
				>
					<div className="relative h-full w-full">
						<MapCanvas
							size={800}
							slamImgRef={{ current: null }}
							mapDims={mapDims}
							waypoints={[]}
							dronePos={null}
							people={detections.map((d) => ({
								x: d.x,
								y: d.y,
								ts: d.timestamp
							}))}
							confirmedDetections={[]}
							allPedestrians={[]}
							polyPoints={[]}
							drawingPoly={false}
							supervisorActive={false}
							className="h-full w-full object-contain"
						/>
					</div>
				</div>

				{/* Live Log */}
				<div
					className="col-span-1 flex flex-col overflow-hidden rounded-xl"
					style={{
						background: 'rgba(255,255,255,0.03)',
						border: '1px solid rgba(255,255,255,0.08)'
					}}
				>
					<div
						className="border-b bg-black/20 p-4 font-mono text-xs font-bold tracking-widest text-white/50 uppercase"
						style={{ borderColor: 'rgba(255,255,255,0.08)' }}
					>
						Detection Log
					</div>
					<div className="flex flex-1 flex-col gap-2 overflow-auto p-4">
						{detections.map((det) => (
							<div
								key={det.id}
								onClick={() => setSelectedDetection(det)}
								className="cursor-pointer rounded border p-3 transition-colors hover:bg-white/5"
								style={{
									borderColor:
										det.status === 'rescued'
											? 'rgba(16,185,129,0.3)'
											: det.dispatched
												? 'rgba(59,130,246,0.3)'
												: 'rgba(245,158,11,0.3)',
									background: 'rgba(0,0,0,0.2)'
								}}
							>
								<div className="flex items-center justify-between">
									<span className="font-mono text-xs font-bold text-white/70">
										ID: #{det.id}
									</span>
									<span className="font-mono text-[10px] text-white/40">
										{new Date(det.timestamp * 1000).toLocaleTimeString()}
									</span>
								</div>
								<div className="mt-2 font-mono text-xs text-white/60">
									X: {det.x.toFixed(1)} | Y: {det.y.toFixed(1)}
								</div>
								<div className="mt-2 flex gap-2">
									{det.dispatched && (
										<span className="rounded bg-blue-500/20 px-1.5 py-0.5 font-mono text-[9px] font-bold text-blue-400">
											DISPATCHED
										</span>
									)}
									{det.status !== 'pending' && (
										<span
											className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-bold ${det.status === 'rescued' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}
										>
											{det.status.toUpperCase()}
										</span>
									)}
								</div>
							</div>
						))}
					</div>
				</div>
			</div>

			{/* Details Dialog */}
			<Dialog
				open={!!selectedDetection}
				onOpenChange={(o) => !o && setSelectedDetection(null)}
			>
				<DialogContent className="border-emerald-500/30 bg-[#0a0f1e] text-white">
					<DialogHeader>
						<DialogTitle className="font-mono text-lg font-bold text-emerald-400">
							Detection Details
						</DialogTitle>
					</DialogHeader>
					{selectedDetection && (
						<div className="mt-4 space-y-6">
							<div className="grid grid-cols-2 gap-4 rounded border border-white/10 bg-black/40 p-4 font-mono text-sm">
								<div>
									<p className="text-[10px] text-white/40 uppercase">
										Longitude (X)
									</p>
									<p className="font-bold">{selectedDetection.x.toFixed(2)}</p>
								</div>
								<div>
									<p className="text-[10px] text-white/40 uppercase">
										Latitude (Y)
									</p>
									<p className="font-bold">{selectedDetection.y.toFixed(2)}</p>
								</div>
								<div>
									<p className="text-[10px] text-white/40 uppercase">Radius</p>
									<p className="font-bold">
										{selectedDetection.radius.toFixed(1)}m
									</p>
								</div>
								<div>
									<p className="text-[10px] text-white/40 uppercase">Time</p>
									<p className="font-bold">
										{new Date(
											selectedDetection.timestamp * 1000
										).toLocaleTimeString()}
									</p>
								</div>
							</div>

							<div className="space-y-3">
								<p className="font-mono text-xs tracking-widest text-white/50 uppercase">
									Actions
								</p>

								<button
									onClick={() =>
										updateDetectionStatus(selectedDetection.id, {
											dispatched: !selectedDetection.dispatched
										})
									}
									className={`w-full rounded p-3 font-mono text-sm font-bold uppercase transition-colors ${
										selectedDetection.dispatched
											? 'border border-blue-500/30 bg-blue-500/20 text-blue-400'
											: 'border border-white/10 bg-white/5 text-white/70 hover:bg-white/10'
									}`}
								>
									{selectedDetection.dispatched
										? 'Team Dispatched'
										: 'Dispatch Rescue Team'}
								</button>

								<div className="grid grid-cols-2 gap-3">
									<button
										onClick={() =>
											updateDetectionStatus(selectedDetection.id, {
												status: 'rescued'
											})
										}
										className={`rounded p-3 font-mono text-sm font-bold uppercase transition-colors ${
											selectedDetection.status === 'rescued'
												? 'border border-emerald-500/30 bg-emerald-500/20 text-emerald-400'
												: 'border border-white/10 bg-white/5 text-white/70 hover:bg-white/10'
										}`}
									>
										Mark Rescued
									</button>
									<button
										onClick={() =>
											updateDetectionStatus(selectedDetection.id, {
												status: 'false_alarm'
											})
										}
										className={`rounded p-3 font-mono text-sm font-bold uppercase transition-colors ${
											selectedDetection.status === 'false_alarm'
												? 'border border-red-500/30 bg-red-500/20 text-red-400'
												: 'border border-white/10 bg-white/5 text-white/70 hover:bg-white/10'
										}`}
									>
										False Alarm
									</button>
								</div>
							</div>
						</div>
					)}
				</DialogContent>
			</Dialog>
		</div>
	);
}
