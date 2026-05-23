'use client';

import * as React from 'react';
import {
	IconHome,
	IconBriefcase,
	IconUsers,
	IconPlus,
	IconUpload,
	IconChartBar,
	IconChevronRight,
	IconSparkles,
	IconUser,
	IconBuilding,
	IconSettings
} from '@tabler/icons-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NavUser } from '@/components/layout/nav-user';
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSub,
	SidebarMenuSubButton,
	SidebarMenuSubItem,
	SidebarRail
} from '@/components/ui/sidebar';
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger
} from '@/components/ui/collapsible';

const user = {
	name: 'Recruiter',
	email: 'recruiter@cognicv.ai',
	avatar: '/avatars/recruiter.jpg'
};

const navItems = [
	{
		title: 'Home',
		url: '/dashboard',
		icon: IconHome
	},
	{
		title: 'Job Listings',
		url: '/dashboard/jobs',
		icon: IconBriefcase,
		children: [
			{ title: 'All Jobs', url: '/dashboard/jobs', icon: IconBriefcase },
			{ title: 'Create New Job', url: '/dashboard/jobs/new', icon: IconPlus }
		]
	},
	{
		title: 'Talent Pool',
		url: '/dashboard/talent',
		icon: IconUsers
	},
	{
		title: 'Settings',
		url: '/dashboard/settings',
		icon: IconSettings,
		children: [
			{ title: 'Profile', url: '/dashboard/profile', icon: IconUser },
			{
				title: 'Organization',
				url: '/dashboard/organization',
				icon: IconBuilding
			}
		]
	}
];

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
	const pathname = usePathname();

	return (
		<Sidebar collapsible="icon" {...props}>
			<SidebarHeader>
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton
							size="lg"
							className="hover:bg-transparent"
							asChild
						>
							<Link href="/dashboard">
								<div className="bg-primary text-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
									<IconSparkles className="size-4" />
								</div>
								<div className="grid flex-1 text-left text-sm leading-tight">
									<span className="font-lora truncate text-xl font-semibold">
										Your Company
									</span>
								</div>
							</Link>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarHeader>

			<SidebarContent>
				<SidebarGroup>
					<SidebarGroupLabel>Navigation</SidebarGroupLabel>
					<SidebarMenu>
						{navItems.map((item) => {
							const isExactMatch = pathname === item.url;
							const isActive =
								isExactMatch ||
								(item.url !== '/dashboard' && pathname.startsWith(item.url));

							if (!item.children) {
								return (
									<SidebarMenuItem key={item.title}>
										<SidebarMenuButton
											asChild
											isActive={isActive}
											tooltip={item.title}
										>
											<Link href={item.url}>
												<item.icon className="size-4" />
												<span>{item.title}</span>
											</Link>
										</SidebarMenuButton>
									</SidebarMenuItem>
								);
							}

							return (
								<Collapsible
									key={item.title}
									asChild
									defaultOpen={isActive}
									className="group/collapsible"
								>
									<SidebarMenuItem>
										<CollapsibleTrigger asChild>
											<SidebarMenuButton
												tooltip={item.title}
												isActive={isActive}
											>
												<item.icon className="size-4" />
												<span>{item.title}</span>
												<IconChevronRight className="ml-auto size-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
											</SidebarMenuButton>
										</CollapsibleTrigger>
										<CollapsibleContent>
											<SidebarMenuSub>
												{item.children.map((child) => (
													<SidebarMenuSubItem key={child.title}>
														<SidebarMenuSubButton
															asChild
															isActive={pathname === child.url}
														>
															<Link href={child.url}>
																<child.icon className="size-3.5" />
																<span>{child.title}</span>
															</Link>
														</SidebarMenuSubButton>
													</SidebarMenuSubItem>
												))}
											</SidebarMenuSub>
										</CollapsibleContent>
									</SidebarMenuItem>
								</Collapsible>
							);
						})}
					</SidebarMenu>
				</SidebarGroup>
			</SidebarContent>

			<SidebarFooter>
				<NavUser user={user} />
			</SidebarFooter>
			<SidebarRail />
		</Sidebar>
	);
}
