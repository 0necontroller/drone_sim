import { headingFont } from '@/lib/fonts';
import { Telemetry } from '@/types/drone';

interface HeaderProps {
	connection: string;
	telemetry: Telemetry;
	children: React.ReactNode;
}

export default function Header({
	connection,
	telemetry,
	children
}: HeaderProps) {
	return (
		<header className="mb-8 flex flex-row items-center gap-12">
			<div className="flex w-fit flex-col gap-2">
				<p className="text-sm font-medium tracking-[0.4em] text-gray-400 uppercase">
					Drone Ops Console
				</p>
				<h1
					className={`${headingFont.className} text-4xl text-gray-900 md:text-5xl`}
				>
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
			</div>

			{children}
		</header>
	);
}
