"use client";

import React, { useState, useMemo, useEffect } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslations } from "next-intl";

interface Column<T> {
  header: string;
  accessorKey?: keyof T;
  cell?: (item: T) => React.ReactNode;
  width?: string;
}

interface DynamicTableProps<T> {
  data: T[] | undefined;
  columns: Column<T>[];
  rowClassName?: (item: T) => string;
  pagination?: boolean;

  // Original pagination props (for internal pagination)
  pageSize?: number;
  pageSizeOptions?: number[];

  // New pagination props (for external pagination)
  currentPage?: number;
  totalPages?: number;
  totalItems?: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  externalPagination?: boolean; // Flag to indicate external pagination is being used
}

export function DynamicTable<T>({
  data = [],
  columns,
  rowClassName,
  pagination = false,
  pageSize: initialPageSize = 10,
  pageSizeOptions = [5, 10, 25, 50],
  // External pagination props
  currentPage: externalCurrentPage,
  totalPages: externalTotalPages,
  totalItems: externalTotalItems,
  onPageChange,
  onPageSizeChange,
  externalPagination = false,
}: DynamicTableProps<T>) {
  const t = useTranslations("dynamictable");

  // Internal pagination state (used if external pagination is not provided)
  const [internalCurrentPage, setInternalCurrentPage] = useState(1);
  const [internalPageSize, setInternalPageSize] = useState(initialPageSize);

  // Use external or internal state based on props
  const currentPage = externalPagination
    ? externalCurrentPage || 1
    : internalCurrentPage;
  const pageSize = externalPagination ? initialPageSize : internalPageSize;

  // Ensure data is always an array
  const safeData = useMemo(() => {
    return Array.isArray(data) ? data : [];
  }, [data]);

  // Calculate pagination values
  const paginationData = useMemo(() => {
    if (externalPagination) {
      // Use external values if provided
      return {
        totalItems: externalTotalItems || 0,
        totalPages: externalTotalPages || 1,
        startIndex: 0, // Not needed for external pagination
        endIndex: safeData.length, // Not needed for external pagination
      };
    } else {
      // Calculate internally
      const totalItems = safeData.length;
      const totalPages = Math.ceil(totalItems / pageSize);
      const startIndex = (internalCurrentPage - 1) * pageSize;
      const endIndex = Math.min(startIndex + pageSize, totalItems);

      return {
        totalItems,
        totalPages,
        startIndex,
        endIndex,
      };
    }
  }, [
    safeData,
    pageSize,
    internalCurrentPage,
    externalPagination,
    externalTotalItems,
    externalTotalPages,
  ]);

  // Get current page data (only for internal pagination)
  const currentData = useMemo(() => {
    if (externalPagination) {
      // When using external pagination, data is already filtered
      return safeData;
    } else if (pagination) {
      // Filter data for internal pagination
      return safeData.slice(paginationData.startIndex, paginationData.endIndex);
    } else {
      // No pagination
      return safeData;
    }
  }, [
    safeData,
    pagination,
    paginationData.startIndex,
    paginationData.endIndex,
    externalPagination,
  ]);

  // Reset internal page when page size changes or data changes
  useEffect(() => {
    if (!externalPagination) {
      setInternalCurrentPage(1);
    }
  }, [externalPagination, safeData.length, internalPageSize]);

  // Handle page change based on pagination mode
  const handlePageChange = (newPage: number) => {
    if (externalPagination && onPageChange) {
      // External pagination - delegate to parent
      onPageChange(newPage);
    } else {
      // Internal pagination - handle locally
      setInternalCurrentPage(newPage);
    }
  };

  // Handle page size change based on pagination mode
  const handlePageSizeChange = (value: string) => {
    const newSize = parseInt(value, 10);

    if (externalPagination && onPageSizeChange) {
      // External pagination - delegate to parent
      onPageSizeChange(newSize);
    } else {
      // Internal pagination - handle locally
      setInternalPageSize(newSize);
      setInternalCurrentPage(1); // Reset to first page when changing page size
    }
  };

  return (
    <div className="w-full">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((column, index) => (
                <TableHead
                  key={index}
                  style={{ width: column.width || "auto" }}
                >
                  {column.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {currentData.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  {t("noData")}
                </TableCell>
              </TableRow>
            ) : (
              currentData.map((item, rowIndex) => (
                <TableRow
                  key={rowIndex}
                  className={rowClassName ? rowClassName(item) : undefined}
                >
                  {columns.map((column, colIndex) => (
                    <TableCell key={colIndex}>
                      {column.cell
                        ? column.cell(item)
                        : column.accessorKey
                        ? (item[column.accessorKey] as React.ReactNode)
                        : null}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {pagination && paginationData.totalItems > 0 && (
        <div className="flex items-center justify-between space-x-2 py-3 px-4 border-t bg-gray-50/50">
          <div className="flex items-center space-x-2">
            <p className="text-xs text-gray-600">{t("rowsPerPage")}</p>
            <Select
              value={pageSize.toString()}
              onValueChange={handlePageSizeChange}
            >
              <SelectTrigger className="h-7 w-16 text-xs border-gray-200">
                <SelectValue
                  placeholder={pageSize === -1 ? "ALL" : pageSize.toString()}
                />
              </SelectTrigger>
              <SelectContent className="bg-white" side="top">
                {pageSizeOptions.map((size) => (
                  <SelectItem
                    key={size}
                    value={size.toString()}
                    className="text-xs"
                  >
                    {size === -1 ? "ALL" : size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center space-x-1">
            <div className="flex items-center justify-center text-xs text-gray-600 min-w-[80px]">
              {t("pageOf", {
                current: currentPage,
                total: paginationData.totalPages || 1,
              })}
            </div>
            <div className="flex items-center space-x-1">
              <Button
                variant="ghost"
                className="hidden h-7 w-7 p-0 lg:flex hover:bg-gray-100"
                onClick={() => handlePageChange(1)}
                disabled={currentPage === 1}
              >
                <span className="sr-only">Go to first page</span>
                <ChevronsLeft className="h-3 w-3 text-gray-400" />
              </Button>
              <Button
                variant="ghost"
                className="h-7 w-7 p-0 hover:bg-gray-100"
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
              >
                <span className="sr-only">Go to previous page</span>
                <ChevronLeft className="h-3 w-3 text-gray-400" />
              </Button>
              <Button
                variant="ghost"
                className="h-7 w-7 p-0 hover:bg-gray-100"
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={
                  currentPage === paginationData.totalPages ||
                  paginationData.totalPages === 0
                }
              >
                <span className="sr-only">Go to next page</span>
                <ChevronRight className="h-3 w-3 text-gray-400" />
              </Button>
              <Button
                variant="ghost"
                className="hidden h-7 w-7 p-0 lg:flex hover:bg-gray-100"
                onClick={() => handlePageChange(paginationData.totalPages)}
                disabled={
                  currentPage === paginationData.totalPages ||
                  paginationData.totalPages === 0
                }
              >
                <span className="sr-only">Go to last page</span>
                <ChevronsRight className="h-3 w-3 text-gray-400" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
