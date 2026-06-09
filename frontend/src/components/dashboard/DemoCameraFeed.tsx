import { serverUrl } from '@/lib/config';

interface DemoCameraFeedProps {
	className?: string;
}

export default function DemoCameraFeed({ className = '' }: DemoCameraFeedProps) {
	if (!serverUrl) {
		return (
			<div className={`flex items-center justify-center bg-slate-950 ${className}`}>
				<div className="text-center">
					<div className="mb-3 text-4xl opacity-30">📷</div>
					<p className="text-sm font-mono" style={{ color: 'rgba(255,255,255,0.3)' }}>
						Camera feed unavailable
					</p>
				</div>
			</div>
		);
	}

	return (
		<img
			src={`${serverUrl}/api/v1/demo/camera.mjpeg`}
			className={className}
			style={{ objectFit: 'cover' }}
			alt="Real Drone Feed"
		/>
	);
}
