import { headingFont } from '@/lib/fonts';
import { Telemetry } from '@/types/drone';

interface HeaderProps {
	connection: string;
	telemetry: Telemetry;
}

export default function Header({ connection, telemetry }: HeaderProps) {
	return (
		<header className="flex flex-col gap-2 mb-8">
			<p className="text-sm tracking-[0.4em] text-gray-400 uppercase font-medium">
				Drone Ops Console
			</p>
			<h1 className={`${headingFont.className} text-4xl md:text-5xl text-gray-900`}>
				Mavic Control Deck
			</h1>
			<div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-gray-600">
				<span className="rounded-full border border-gray-200 bg-white px-4 py-1.5 shadow-sm">
					WebSocket: <span className="font-semibold">{connection}</span>
				</span>
				<span className="rounded-full border border-gray-200 bg-white px-4 py-1.5 shadow-sm">
					Telemetry:{' '}
					<span className="font-semibold">
						{telemetry.time ? `${telemetry.time.toFixed(1)}s` : '--'}
					</span>
				</span>
			</div>
		</header>
	);
}
