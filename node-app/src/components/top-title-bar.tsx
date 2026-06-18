"use client";

import Image from "next/image";
import Link from "next/link";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UserMenu } from "@/components/user-menu";

export function TopTitleBar() {
  return (
    <header className="border-b border-gray-800 bg-gray-900/80 backdrop-blur-sm sticky top-0 z-20 w-full">
      <div className="px-4 py-4 md:px-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Image
              src="/logo-silver.svg"
              alt="Legal AI Logo"
              width={32}
              height={32}
              className="h-8 w-8"
            />
            <h1 className="text-xl font-bold text-gray-100">
              Legal Document Analysis AI
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/workflow">
              <Button
                variant="ghost"
                size="sm"
                className="text-gray-200 hover:text-white hover:bg-gray-800"
              >
                <Settings className="mr-2 h-4 w-4" />
                Workflow Settings
              </Button>
            </Link>
            <UserMenu />
          </div>
        </div>
      </div>
    </header>
  );
}