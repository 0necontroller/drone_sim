'use client';

import { type ControlCommand, type Telemetry } from '@/types/drone';

interface ControlsProps {
	telemetry: Telemetry;
	commandRef: React.MutableRefObject<ControlCommand>;
	updateCommand: (next: Partial<ControlCommand>) => void;
	sendOnce: (command: Partial<ControlCommand>) => void;
}

const btnBase =
	'flex items-center justify-center rounded-xl text-xs font-bold uppercase tracking-wider transition-all active:scale-90 select-none touch-none';

const dirBtn =
	`${btnBase} h-11 w-11 border`;

function DirButton({
	label,
	onDown,
	onUp,
}: {
	label: string;
	onDown: () => void;
	onUp: () => void;
}) {
	return (
		<button
			className={dirBtn}
			onPointerDown={onDown}
			onPointerUp={onUp}
			onPointerLeave={onUp}
			style={{
				background: 'rgba(255,255,255,0.07)',
				border: '1px solid rgba(255,255,255,0.12)',
				color: 'rgba(255,255,255,0.8)',
			}}
		>
			{label}
		</button>
	);
}

function AltButton({
	label,
	onClick,
	up,
}: {
	label: string;
	onClick: () => void;
	up: boolean;
}) {
	return (
		<button
			className={`${btnBase} w-full py-2.5 rounded-xl border text-xs font-bold`}
			onClick={onClick}
			style={{
				background: up ? 'rgba(0,255,136,0.1)' : 'rgba(239,68,68,0.1)',
				border: up ? '1px solid rgba(0,255,136,0.25)' : '1px solid rgba(239,68,68,0.25)',
				color: up ? '#00ff88' : '#ef4444',
			}}
		>
			{label}
		</button>
	);
}

export default function Controls({
	telemetry,
	commandRef,
	updateCommand,
	sendOnce,
}: ControlsProps) {
	return (
		<div className="flex flex-col gap-3 p-3 w-52">
			{/* Altitude readout */}
			<div
				className="flex items-center justify-between rounded-xl px-3 py-2"
				style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
			>
				<span className="text-[9px] font-bold tracking-[0.2em] uppercase" style={{ color: 'rgba(0,255,136,0.6)' }}>
					Alt
				</span>
				<span className="font-mono text-lg font-bold" style={{ color: '#00ff88' }}>
					{telemetry.altitude != null ? telemetry.altitude.toFixed(1) : '--'}
					<span className="ml-0.5 text-xs font-normal" style={{ color: 'rgba(0,255,136,0.5)' }}>m</span>
				</span>
			</div>

			{/* Altitude controls */}
			<div className="grid grid-cols-2 gap-2">
				<AltButton label="▲ UP" onClick={() => sendOnce({ altitude_delta: 0.2 })} up />
				<AltButton label="▼ DOWN" onClick={() => sendOnce({ altitude_delta: -0.2 })} up={false} />
			</div>

			{/* Divider */}
			<div className="h-px mx-1" style={{ background: 'rgba(255,255,255,0.07)' }} />

			{/* D-Pad */}
			<div className="flex flex-col items-center gap-1.5">
				<p className="text-[9px] font-bold tracking-[0.25em] uppercase self-start mb-0.5" style={{ color: 'rgba(255,255,255,0.3)' }}>
					Direction
				</p>
				{/* Forward */}
				<DirButton
					label="▲"
					onDown={() => updateCommand({ pitch: -2.0 })}
					onUp={() => updateCommand({ pitch: 0 })}
				/>
				{/* Left / (spacer) / Right */}
				<div className="flex items-center gap-1.5">
					<DirButton
						label="◄"
						onDown={() => updateCommand({ roll: 1.0 })}
						onUp={() => updateCommand({ roll: 0 })}
					/>
					{/* Center circle */}
					<div
						className="h-11 w-11 rounded-full flex items-center justify-center"
						style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
					>
						<div className="h-2 w-2 rounded-full" style={{ background: 'rgba(0,255,136,0.4)' }} />
					</div>
					<DirButton
						label="►"
						onDown={() => updateCommand({ roll: -1.0 })}
						onUp={() => updateCommand({ roll: 0 })}
					/>
				</div>
				{/* Back */}
				<DirButton
					label="▼"
					onDown={() => updateCommand({ pitch: 2.0 })}
					onUp={() => updateCommand({ pitch: 0 })}
				/>
			</div>

			{/* Divider */}
			<div className="h-px mx-1" style={{ background: 'rgba(255,255,255,0.07)' }} />

			{/* Yaw */}
			<div className="flex flex-col gap-1.5">
				<p className="text-[9px] font-bold tracking-[0.25em] uppercase" style={{ color: 'rgba(255,255,255,0.3)' }}>
					Yaw
				</p>
				<div className="grid grid-cols-2 gap-2">
					<button
						className={`${btnBase} py-2.5 rounded-xl border`}
						onPointerDown={() => updateCommand({ yaw: -1.0 })}
						onPointerUp={() => updateCommand({ yaw: 0 })}
						onPointerLeave={() => updateCommand({ yaw: 0 })}
						style={{
							background: 'rgba(96,165,250,0.1)',
							border: '1px solid rgba(96,165,250,0.2)',
							color: '#60a5fa',
						}}
					>
						↺ L
					</button>
					<button
						className={`${btnBase} py-2.5 rounded-xl border`}
						onPointerDown={() => updateCommand({ yaw: 1.0 })}
						onPointerUp={() => updateCommand({ yaw: 0 })}
						onPointerLeave={() => updateCommand({ yaw: 0 })}
						style={{
							background: 'rgba(96,165,250,0.1)',
							border: '1px solid rgba(96,165,250,0.2)',
							color: '#60a5fa',
						}}
					>
						R ↻
					</button>
				</div>
			</div>
		</div>
	);
}
