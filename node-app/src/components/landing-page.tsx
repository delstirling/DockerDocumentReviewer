"use client";

import { AnimatedBackground } from "./harmonic-hero";
import { Button } from "./ui/button";
import { ArrowRight, FileText, Brain, Shield, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import Image from "next/image";

export function LandingPage() {
  const router = useRouter();

  return (
    <div className="relative min-h-screen bg-gray-950">
      <AnimatedBackground />

      {/* Header */}
      <header className="relative z-10 border-b border-gray-800 bg-gray-900/80 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Image
              src="/logo-silver.svg"
              alt="Document Reviewer Logo"
              width={32}
              height={32}
              className="h-8 w-8"
            />
            <span className="text-xl font-bold text-gray-100">
              Document Reviewer
            </span>
          </div>
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              className="text-gray-300 hover:text-gray-100"
              onClick={() => router.push("/auth/signin")}
            >
              Sign In
            </Button>
            <Button
              className="bg-blue-600 hover:bg-blue-700 text-white"
              onClick={() => router.push("/auth/signin?callbackUrl=/dashboard")}
            >
              Get Started
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="relative z-10 container mx-auto px-4 py-20">
        <div className="max-w-5xl mx-auto text-center space-y-8">
          {/* Main Heading */}
          <div className="space-y-4">
            <h1 className="text-5xl md:text-7xl font-bold text-gray-100 leading-tight">
              AI-Powered Legal
              <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">
                Document Analysis
              </span>
            </h1>
            <p className="text-xl md:text-2xl text-gray-400 max-w-3xl mx-auto">
              Transform complex legal documents into actionable insights with
              advanced AI analysis
            </p>
          </div>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
            <Button
              size="lg"
              className="bg-blue-600 hover:bg-blue-700 text-white text-lg px-8 py-6"
              onClick={() => router.push("/auth/signin?callbackUrl=/dashboard")}
            >
              Start Analyzing
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="border-gray-600 text-gray-300 hover:bg-gray-800 text-lg px-8 py-6"
              onClick={() => {
                // Scroll to features section
                document
                  .getElementById("features")
                  ?.scrollIntoView({ behavior: "smooth" });
              }}
            >
              Learn More
            </Button>
          </div>

          {/* Features Grid */}
          <div
            id="features"
            className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 pt-20"
          >
            <div className="p-6 rounded-lg bg-gray-900/80 backdrop-blur-sm border border-gray-800 hover:border-gray-700 transition-colors">
              <div className="flex flex-col items-center text-center space-y-3">
                <div className="p-3 rounded-full bg-blue-600/20">
                  <FileText className="h-8 w-8 text-blue-400" />
                </div>
                <h3 className="text-lg font-semibold text-gray-100">
                  Document Upload
                </h3>
                <p className="text-sm text-gray-400">
                  Support for PDF, DOCX, and various legal document formats
                </p>
              </div>
            </div>

            <div className="p-6 rounded-lg bg-gray-900/80 backdrop-blur-sm border border-gray-800 hover:border-gray-700 transition-colors">
              <div className="flex flex-col items-center text-center space-y-3">
                <div className="p-3 rounded-full bg-purple-600/20">
                  <Brain className="h-8 w-8 text-purple-400" />
                </div>
                <h3 className="text-lg font-semibold text-gray-100">
                  AI Analysis
                </h3>
                <p className="text-sm text-gray-400">
                  Powered by Claude Sonnet for deep legal reasoning
                </p>
              </div>
            </div>

            <div className="p-6 rounded-lg bg-gray-900/80 backdrop-blur-sm border border-gray-800 hover:border-gray-700 transition-colors">
              <div className="flex flex-col items-center text-center space-y-3">
                <div className="p-3 rounded-full bg-green-600/20">
                  <Shield className="h-8 w-8 text-green-400" />
                </div>
                <h3 className="text-lg font-semibold text-gray-100">
                  Secure & Private
                </h3>
                <p className="text-sm text-gray-400">
                  Enterprise-grade security with encrypted storage
                </p>
              </div>
            </div>

            <div className="p-6 rounded-lg bg-gray-900/80 backdrop-blur-sm border border-gray-800 hover:border-gray-700 transition-colors">
              <div className="flex flex-col items-center text-center space-y-3">
                <div className="p-3 rounded-full bg-orange-600/20">
                  <Zap className="h-8 w-8 text-orange-400" />
                </div>
                <h3 className="text-lg font-semibold text-gray-100">
                  Fast Results
                </h3>
                <p className="text-sm text-gray-400">
                  Get comprehensive analysis in minutes, not hours
                </p>
              </div>
            </div>
          </div>

          {/* Social Proof / Trust Section */}
          <div className="pt-20 space-y-6">
            <p className="text-sm text-gray-500 uppercase tracking-wider">
              Trusted by Legal Professionals
            </p>
            <div className="flex flex-wrap items-center justify-center gap-8 opacity-50">
              <div className="text-gray-600 font-semibold text-lg">
                Law Firms
              </div>
              <div className="text-gray-600 font-semibold text-lg">
                Corporate Legal
              </div>
              <div className="text-gray-600 font-semibold text-lg">
                Solo Practitioners
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-gray-800 bg-gray-900/80 backdrop-blur-sm mt-20">
        <div className="container mx-auto px-4 py-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Image
                src="/logo-silver.svg"
                alt="Document Reviewer Logo"
                width={24}
                height={24}
                className="h-6 w-6"
              />
              <span className="text-gray-400 text-sm">
                © {new Date().getFullYear()} Document Reviewer. All rights
                reserved.
              </span>
            </div>
            <div className="flex items-center gap-6 text-sm text-gray-400">
              <a href="#" className="hover:text-gray-100 transition-colors">
                Privacy Policy
              </a>
              <a href="#" className="hover:text-gray-100 transition-colors">
                Terms of Service
              </a>
              <a href="#" className="hover:text-gray-100 transition-colors">
                Contact
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
