"use client"

import { Fragment, type ReactNode } from "react"
import Link from "next/link"

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"

/**
 * Page header relocated from the @reui/dashboard-6 CoverageHeader: a breadcrumb
 * on the left, actions on the right. `crumbs` drives the breadcrumb so every
 * route reuses it; `actions` is the right side, chosen per route by
 * PageHeaderActions. The block's own date-range + Export pair now lives there as
 * one case among many, so this component is just the layout.
 */
export function PageHeader({
  crumbs,
  actions,
}: {
  crumbs: string[]
  actions?: ReactNode
}) {
  const trail = crumbs.slice(0, -1)
  const current = crumbs[crumbs.length - 1]

  return (
    <header
      className="flex min-h-9 w-full shrink-0 items-center justify-between gap-2"
      aria-label="Page header"
    >
      <Breadcrumb className="min-w-0">
        <BreadcrumbList className="flex-nowrap">
          {trail.map((crumb, index) => (
            <Fragment key={crumb}>
              <BreadcrumbItem className="hidden md:inline-flex">
                {index === 0 ? (
                  <BreadcrumbLink render={<Link href="/" />}>
                    {crumb}
                  </BreadcrumbLink>
                ) : (
                  <span>{crumb}</span>
                )}
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:flex" />
            </Fragment>
          ))}
          <BreadcrumbItem className="min-w-0">
            <BreadcrumbPage className="truncate">{current}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex shrink-0 items-center gap-2">{actions}</div>
    </header>
  )
}
