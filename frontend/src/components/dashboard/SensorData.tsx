import { Telemetry } from '@/types/drone';

interface SensorDataProps {
	telemetry: Telemetry;
}

export default function SensorData({ telemetry }: SensorDataProps) {
	return (
		<div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6">
			{/* Orientation Card */}
			<div className="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
				<p className="text-xs tracking-[0.2em] text-gray-400 uppercase font-semibold mb-4">
					Orientation
				</p>
				<div className="grid grid-cols-3 gap-4 text-sm">
					<div className="rounded-xl border border-gray-50 bg-gray-50 p-3">
						<p className="text-gray-500 mb-1">Roll</p>
						<p className="font-semibold text-gray-900 text-lg">
							{telemetry.roll?.toFixed(3) ?? '--'}
						</p>
					</div>
					<div className="rounded-xl border border-gray-50 bg-gray-50 p-3">
						<p className="text-gray-500 mb-1">Pitch</p>
						<p className="font-semibold text-gray-900 text-lg">
							{telemetry.pitch?.toFixed(3) ?? '--'}
						</p>
					</div>
					<div className="rounded-xl border border-gray-50 bg-gray-50 p-3">
						<p className="text-gray-500 mb-1">Yaw</p>
						<p className="font-semibold text-gray-900 text-lg">
							{telemetry.yaw?.toFixed(3) ?? '--'}
						</p>
					</div>
				</div>
			</div>

			{/* GPS Card */}
			<div className="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
				<p className="text-xs tracking-[0.2em] text-gray-400 uppercase font-semibold mb-4">
					GPS Coordinates
				</p>
				<div className="grid grid-cols-3 gap-4 text-sm">
					<div className="rounded-xl border border-gray-50 bg-gray-50 p-3">
						<p className="text-gray-500 mb-1">X</p>
						<p className="font-semibold text-gray-900 text-lg">
							{telemetry.x?.toFixed(2) ?? '--'}
						</p>
					</div>
					<div className="rounded-xl border border-gray-50 bg-gray-50 p-3">
						<p className="text-gray-500 mb-1">Y</p>
						<p className="font-semibold text-gray-900 text-lg">
							{telemetry.y?.toFixed(2) ?? '--'}
						</p>
					</div>
					<div className="rounded-xl border border-gray-50 bg-gray-50 p-3">
						<p className="text-gray-500 mb-1">Z</p>
						<p className="font-semibold text-gray-900 text-lg">
							{telemetry.z?.toFixed(2) ?? '--'}
						</p>
					</div>
				</div>
			</div>

			{/* Angular Velocity Card */}
			<div className="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
				<p className="text-xs tracking-[0.2em] text-gray-400 uppercase font-semibold mb-4">
					Angular Velocity
				</p>
				<div className="grid grid-cols-2 gap-4 text-sm">
					<div className="rounded-xl border border-gray-50 bg-gray-50 p-3">
						<p className="text-gray-500 mb-1">Roll Rate</p>
						<p className="font-semibold text-gray-900 text-lg">
							{telemetry.roll_velocity?.toFixed(3) ?? '--'}
						</p>
					</div>
					<div className="rounded-xl border border-gray-50 bg-gray-50 p-3">
						<p className="text-gray-500 mb-1">Pitch Rate</p>
						<p className="font-semibold text-gray-900 text-lg">
							{telemetry.pitch_velocity?.toFixed(3) ?? '--'}
						</p>
					</div>
				</div>
			</div>
		</div>
	);
}
