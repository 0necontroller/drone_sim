import { headingFont } from '@/lib/fonts';
import { Telemetry, ControlCommand } from '@/types/drone';

interface ControlsProps {
	telemetry: Telemetry;
	commandRef: React.MutableRefObject<ControlCommand>;
	updateCommand: (next: Partial<ControlCommand>) => void;
	sendOnce: (command: Partial<ControlCommand>) => void;
}

export default function Controls({
	telemetry,
	commandRef,
	updateCommand,
	sendOnce
}: ControlsProps) {
	return (
		<div className="flex flex-row gap-6">
			<div className="flex flex-1 flex-row gap-6 rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
				<div className="mb-6 flex flex-col gap-2">
					<p className="text-xs font-semibold tracking-[0.2em] text-gray-400 uppercase">
						Control
					</p>
					<h2 className={`${headingFont.className} text-2xl text-gray-900`}>
						Manual Flight
					</h2>
				</div>

				<div className="flex flex-1 flex-col items-center justify-center gap-6">
					{/* Directional Pad */}
					<div className="flex flex-row">
						<button
							className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-100 active:scale-95 active:bg-gray-200"
							onPointerDown={() => updateCommand({ roll: 1.0 })}
							onPointerUp={() => updateCommand({ roll: 0 })}
						>
							Left
						</button>

						<div className="flex flex-col">
							<button
								className="col-start-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-100 active:scale-95 active:bg-gray-200"
								onPointerDown={() => updateCommand({ pitch: -2.0 })}
								onPointerUp={() => updateCommand({ pitch: 0 })}
							>
								Forward
							</button>

							<button
								className="col-start-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-100 active:scale-95 active:bg-gray-200"
								onPointerDown={() => updateCommand({ pitch: 2.0 })}
								onPointerUp={() => updateCommand({ pitch: 0 })}
							>
								Back
							</button>
						</div>

						<button
							className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-100 active:scale-95 active:bg-gray-200"
							onPointerDown={() => updateCommand({ roll: -1.0 })}
							onPointerUp={() => updateCommand({ roll: 0 })}
						>
							Right
						</button>
					</div>
				</div>
			</div>

			{/* Altitude Controls */}
			<div className="mt-2 w-full gap-6 rounded-2xl border border-gray-100 bg-white p-4">
				<p className="mb-3 text-xs font-medium tracking-[0.2em] text-gray-500 uppercase">
					Altitude
				</p>
				<div className="flex items-center justify-between">
					<span className={`${headingFont.className} text-3xl text-gray-900`}>
						{telemetry.altitude ? telemetry.altitude.toFixed(2) : '--'}{' '}
						<span className="text-lg text-gray-500">m</span>
					</span>
					<div className="flex flex-col gap-2">
						<button
							className="rounded-lg border border-gray-200 bg-white px-4 py-1.5 text-sm text-gray-700 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50 active:bg-gray-100"
							onClick={() => sendOnce({ altitude_delta: 0.2 })}
						>
							Up
						</button>
						<button
							className="rounded-lg border border-gray-200 bg-white px-4 py-1.5 text-sm text-gray-700 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50 active:bg-gray-100"
							onClick={() => sendOnce({ altitude_delta: -0.2 })}
						>
							Down
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
