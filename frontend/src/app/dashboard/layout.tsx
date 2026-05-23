import {
	SidebarInset,
	SidebarProvider,
	SidebarTrigger
} from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/layout/app-sidebar';
import { Separator } from '@/components/ui/separator';

import { DashboardBreadcrumb } from '@/components/layout/dashboard-breadcrumb';

export default function Layout({ children }: { children: React.ReactNode }) {
	return (
		<SidebarProvider>
			<AppSidebar />
			<SidebarInset>
				<header className="bg-background sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b px-6">
					<SidebarTrigger className="-ml-1" />
					<Separator
						orientation="vertical"
						className="mr-2 h-4 data-[orientation=vertical]:h-4"
					/>
					<DashboardBreadcrumb />
				</header>
				<main className="flex-1 p-6 lg:p-10">{children}</main>
			</SidebarInset>
		</SidebarProvider>
	);
}
