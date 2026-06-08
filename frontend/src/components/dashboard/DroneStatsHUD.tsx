'use client';

import { type Telemetry } from '@/types/drone';

interface DroneStatsHUDProps {
	telemetry: Telemetry;
	connection: string;
}

function StatBox({
	label,
	value,
	unit,
	accent = false,
}: {
	label: string;
	value: string;
	unit?: string;
	accent?: boolean;
}) {
	return (
		<div
			className="flex flex-col gap-0.5 rounded-lg px-2.5 py-1.5"
			style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
		>
			<span className="text-[8px] font-bold tracking-[0.2em] uppercase" style={{ color: 'rgba(0,255,136,0.6)' }}>
				{label}
			</span>
			<span
				className="font-mono text-sm font-semibold leading-none"
				style={{ color: accent ? '#00ff88' : 'rgba(255,255,255,0.9)' }}
			>
				{value}
				{unit && <span className="ml-0.5 text-[10px] font-normal" style={{ color: 'rgba(255,255,255,0.4)' }}>{unit}</span>}
			</span>
		</div>
	);
}

function SectionLabel({ label }: { label: string }) {
	return (
		<div className="flex items-center gap-2 mt-1 mb-0.5">
			<span className="text-[8px] font-bold tracking-[0.25em] uppercase" style={{ color: 'rgba(255,255,255,0.3)' }}>
				{label}
			</span>
			<div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
		</div>
	);
}

export default function DroneStatsHUD({ telemetry, connection }: DroneStatsHUDProps) {
	const isConnected = connection === 'open';

	return (
		<div className="flex flex-col gap-1.5 p-3 w-64">
			{/* Connection status */}
			<div className="flex items-center justify-between mb-0.5">
				<div className="flex items-center gap-1.5">
					<span
						className="h-1.5 w-1.5 rounded-full"
						style={{
							background: isConnected ? '#00ff88' : '#ef4444',
							boxShadow: isConnected ? '0 0 6px #00ff88' : '0 0 6px #ef4444',
						}}
					/>
					<span className="text-[9px] font-mono uppercase" style={{ color: 'rgba(255,255,255,0.4)' }}>
						{isConnected ? 'LINK ACTIVE' : 'NO LINK'}
					</span>
				</div>
				{telemetry.time != null && (
					<span className="text-[9px] font-mono" style={{ color: 'rgba(255,255,255,0.3)' }}>
						T+{telemetry.time.toFixed(1)}s
					</span>
				)}
			</div>

			{/* Altitude — hero stat */}
			<div
				className="flex items-end justify-between rounded-xl px-3 py-2"
				style={{ background: 'rgba(0,255,136,0.06)', border: '1px solid rgba(0,255,136,0.15)' }}
			>
				<div>
					<span className="block text-[8px] font-bold tracking-[0.25em] uppercase" style={{ color: 'rgba(0,255,136,0.6)' }}>
						Altitude
					</span>
					<span className="font-mono text-3xl font-bold leading-none" style={{ color: '#00ff88' }}>
						{telemetry.altitude != null ? telemetry.altitude.toFixed(1) : '--'}
					</span>
					<span className="ml-1 text-sm font-mono" style={{ color: 'rgba(0,255,136,0.5)' }}>m</span>
				</div>
				{telemetry.target_altitude != null && (
					<div className="text-right">
						<span className="block text-[8px]" style={{ color: 'rgba(255,255,255,0.3)' }}>TARGET</span>
						<span className="font-mono text-xs" style={{ color: 'rgba(0,255,136,0.5)' }}>
							{telemetry.target_altitude.toFixed(1)}m
						</span>
					</div>
				)}
			</div>

			{/* Orientation */}
			<SectionLabel label="Orientation" />
			<div className="grid grid-cols-3 gap-1.5">
				<StatBox label="Roll" value={telemetry.roll?.toFixed(2) ?? '--'} unit="°" />
				<StatBox label="Pitch" value={telemetry.pitch?.toFixed(2) ?? '--'} unit="°" />
				<StatBox label="Yaw" value={telemetry.yaw?.toFixed(2) ?? '--'} unit="°" />
			</div>

			{/* GPS */}
			<SectionLabel label="GPS Position" />
			<div className="grid grid-cols-3 gap-1.5">
				<StatBox label="X" value={telemetry.x?.toFixed(1) ?? '--'} unit="m" />
				<StatBox label="Y" value={telemetry.y?.toFixed(1) ?? '--'} unit="m" />
				<StatBox label="Z" value={telemetry.z?.toFixed(1) ?? '--'} unit="m" />
			</div>

			{/* Velocity / Angular rate */}
			<SectionLabel label="Angular Rate" />
			<div className="grid grid-cols-2 gap-1.5">
				<StatBox label="Roll Rate" value={telemetry.roll_velocity?.toFixed(3) ?? '--'} />
				<StatBox label="Pitch Rate" value={telemetry.pitch_velocity?.toFixed(3) ?? '--'} />
			</div>
		</div>
	);
}
