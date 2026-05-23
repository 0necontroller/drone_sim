import { NotFoundComponent } from '@/components/home/not-found';

export default function NotFound() {
	return (
		<>
			<section className="flex min-h-screen flex-col">
				<div className="mb-24 px-4 py-12 md:container lg:mb-0 lg:mt-32 lg:px-32">
					<NotFoundComponent />
				</div>
			</section>
		</>
	);
}
