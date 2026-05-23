'use client';

import { usePathname } from 'next/navigation';
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import React from 'react';
import Link from 'next/link';

export function DashboardBreadcrumb() {
	const pathname = usePathname();
	
	// Example paths:
	// /dashboard -> ['dashboard']
	// /dashboard/jobs -> ['dashboard', 'jobs']
	// /dashboard/jobs/new -> ['dashboard', 'jobs', 'new']
	// /dashboard/jobs/123 -> ['dashboard', 'jobs', '123']
	
	const segments = pathname.split('/').filter(Boolean);
	
	return (
		<Breadcrumb>
			<BreadcrumbList>
				{segments.map((segment, index) => {
					const isLast = index === segments.length - 1;
					const path = `/${segments.slice(0, index + 1).join('/')}`;
					
					// Format segment (e.g., "dashboard" -> "Dashboard", "new" -> "New Job")
					let label = segment.charAt(0).toUpperCase() + segment.slice(1);
					if (segment === 'dashboard') label = 'Home';
					if (segment === 'jobs' && index === 1) label = 'Jobs';
					if (segment === 'applicants') label = 'Applicants';
					if (segment === 'new' && segments[index - 1] === 'jobs') label = 'Create New Job';
					
					// If it's a job ID (a long hash or anything else), maybe format it slightly nicer
					if (segments[index - 1] === 'jobs' && segment !== 'new') {
						label = 'Job Details';
					}

					return (
						<React.Fragment key={path}>
							<BreadcrumbItem>
								{isLast ? (
									<BreadcrumbPage>{label}</BreadcrumbPage>
								) : (
									<BreadcrumbLink asChild>
										<Link href={path}>{label}</Link>
									</BreadcrumbLink>
								)}
							</BreadcrumbItem>
							{!isLast && <BreadcrumbSeparator />}
						</React.Fragment>
					);
				})}
			</BreadcrumbList>
		</Breadcrumb>
	);
}
