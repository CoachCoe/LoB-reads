"use client";

import Link from "next/link";
import {
  BookOpen,
  TrendingUp,
  Target,
  Calendar,
  ArrowLeft,
  CheckCircle,
  Clock,
  ChevronUp,
  ChevronDown,
  Minus
} from "lucide-react";
import { WrappedProjections } from "@/server/wrapped";
import Card, { CardContent, CardHeader } from "@/components/ui/Card";

interface ProjectionsViewProps {
  projections: WrappedProjections;
  userName: string;
}

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

export default function ProjectionsView({ projections, userName }: ProjectionsViewProps) {
  const progressPercentage = (projections.daysElapsed / 365) * 100;
  const nextYear = projections.year + 1;

  return (
    <div className="min-h-screen bg-[var(--background)]">
      {/* Header */}
      <div className="bg-gradient-to-br from-purple-600 via-pink-600 to-red-500 text-white">
        <div className="max-w-4xl mx-auto px-4 py-8">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-white/80 hover:text-white mb-4 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to home
          </Link>
          <h1 className="text-3xl md:text-4xl font-bold mb-2">
            {nextYear} Reading Projections
          </h1>
          <p className="text-white/80">
            Hey {userName}, based on your {projections.year} pace, here&apos;s what {nextYear} could look like
          </p>
        </div>
      </div>

      {/* Year progress bar */}
      <div className="max-w-4xl mx-auto px-4 -mt-4">
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-[var(--foreground-secondary)]">Year Progress</span>
              <span className="text-sm font-medium text-[var(--foreground)]">
                Day {projections.daysElapsed} of 365
              </span>
            </div>
            <div className="h-3 bg-[var(--border)] rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full transition-all duration-500"
                style={{ width: `${progressPercentage}%` }}
              />
            </div>
            <p className="text-sm text-[var(--foreground-secondary)] mt-2 text-center">
              {projections.daysRemaining} days remaining in {projections.year}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main stats grid */}
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* YTD Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="text-center py-6">
              <BookOpen className="h-8 w-8 mx-auto mb-2 text-purple-500" />
              <div className="text-3xl font-bold text-[var(--foreground)]">
                {projections.booksReadYTD}
              </div>
              <p className="text-sm text-[var(--foreground-secondary)]">Books Read</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="text-center py-6">
              <div className="text-3xl mb-2">📖</div>
              <div className="text-3xl font-bold text-[var(--foreground)]">
                {projections.pagesReadYTD.toLocaleString()}
              </div>
              <p className="text-sm text-[var(--foreground-secondary)]">Pages Read</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="text-center py-6">
              <TrendingUp className="h-8 w-8 mx-auto mb-2 text-green-500" />
              <div className="text-3xl font-bold text-[var(--foreground)]">
                {projections.booksPerMonth}
              </div>
              <p className="text-sm text-[var(--foreground-secondary)]">Books/Month</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="text-center py-6">
              <Clock className="h-8 w-8 mx-auto mb-2 text-blue-500" />
              <div className="text-3xl font-bold text-[var(--foreground)]">
                {projections.pagesPerDay}
              </div>
              <p className="text-sm text-[var(--foreground-secondary)]">Pages/Day</p>
            </CardContent>
          </Card>
        </div>

        {/* Projections */}
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold text-[var(--foreground)] flex items-center gap-2">
              <Target className="h-5 w-5 text-purple-500" />
              Year-End Projections
            </h2>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="bg-gradient-to-br from-purple-500/10 to-pink-500/10 rounded-xl p-6">
                <p className="text-sm text-[var(--foreground-secondary)] mb-1">At your current pace, you&apos;ll read</p>
                <div className="text-5xl font-bold text-[var(--foreground)]">
                  {projections.projectedBooksEndOfYear}
                </div>
                <p className="text-lg text-[var(--foreground-secondary)]">books by year end</p>
              </div>
              <div className="bg-gradient-to-br from-blue-500/10 to-cyan-500/10 rounded-xl p-6">
                <p className="text-sm text-[var(--foreground-secondary)] mb-1">Projected pages</p>
                <div className="text-5xl font-bold text-[var(--foreground)]">
                  {projections.projectedPagesEndOfYear.toLocaleString()}
                </div>
                <p className="text-lg text-[var(--foreground-secondary)]">pages total</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Goal tracker */}
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold text-[var(--foreground)] flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-500" />
              Reading Goals
            </h2>
          </CardHeader>
          <CardContent className="space-y-4">
            <GoalCard
              goal={50}
              booksRead={projections.booksReadYTD}
              onTrack={projections.onTrackFor50}
              booksNeededPerMonth={projections.booksNeededPerMonthFor50}
              daysRemaining={projections.daysRemaining}
            />
            <GoalCard
              goal={100}
              booksRead={projections.booksReadYTD}
              onTrack={projections.onTrackFor100}
              booksNeededPerMonth={projections.booksNeededPerMonthFor100}
              daysRemaining={projections.daysRemaining}
            />
          </CardContent>
        </Card>

        {/* Previous year comparison */}
        {projections.previousYearBooks !== null && (
          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold text-[var(--foreground)] flex items-center gap-2">
                <Calendar className="h-5 w-5 text-orange-500" />
                vs Last Year
              </h2>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-[var(--foreground-secondary)]">
                    At this point last year, you had read
                  </p>
                  <p className="text-lg text-[var(--foreground)]">
                    <span className="font-bold">{projections.previousYearBooks}</span> books total in {projections.year - 1}
                  </p>
                </div>
                <div className={`flex items-center gap-1 text-lg font-bold ${
                  projections.aheadOfLastYear
                    ? "text-green-500"
                    : projections.aheadOfLastYear === false
                    ? "text-red-500"
                    : "text-[var(--foreground-secondary)]"
                }`}>
                  {projections.aheadOfLastYear === true && (
                    <>
                      <ChevronUp className="h-5 w-5" />
                      Ahead
                    </>
                  )}
                  {projections.aheadOfLastYear === false && (
                    <>
                      <ChevronDown className="h-5 w-5" />
                      Behind
                    </>
                  )}
                  {projections.aheadOfLastYear === null && (
                    <>
                      <Minus className="h-5 w-5" />
                      Same
                    </>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Monthly breakdown */}
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold text-[var(--foreground)]">
              Monthly Reading
            </h2>
          </CardHeader>
          <CardContent>
            <div className="flex items-end justify-between gap-1 h-40">
              {projections.readingByMonth.map((m) => {
                const maxCount = Math.max(...projections.readingByMonth.map((x) => x.count), 1);
                const height = m.count > 0 ? (m.count / maxCount) * 100 : 4;
                const isFutureMonth = m.month > new Date().getMonth();
                return (
                  <div key={m.month} className="flex flex-col items-center flex-1">
                    <span className="text-xs text-[var(--foreground-secondary)] mb-1">
                      {m.count > 0 ? m.count : ""}
                    </span>
                    <div
                      className={`w-full rounded-t transition-all duration-500 ${
                        isFutureMonth
                          ? "bg-[var(--border)]"
                          : "bg-gradient-to-t from-purple-500 to-pink-500"
                      }`}
                      style={{ height: `${height}%`, minHeight: "4px" }}
                    />
                    <span className="text-xs mt-2 text-[var(--foreground-secondary)]">
                      {MONTH_NAMES[m.month]}
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Currently reading */}
        {projections.currentlyReading.length > 0 && (
          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold text-[var(--foreground)]">
                Currently Reading
              </h2>
            </CardHeader>
            <CardContent className="space-y-3">
              {projections.currentlyReading.map((book) => (
                <div key={book.title} className="flex items-center gap-4">
                  <div className="flex-1">
                    <p className="font-medium text-[var(--foreground)]">{book.title}</p>
                    <p className="text-sm text-[var(--foreground-secondary)]">{book.author}</p>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium text-purple-500">{book.progress}%</div>
                    <div className="w-20 h-2 bg-[var(--border)] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-purple-500 rounded-full"
                        style={{ width: `${book.progress}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Last book finished */}
        {projections.lastBookFinished && (
          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold text-[var(--foreground)]">
                Last Book Finished
              </h2>
            </CardHeader>
            <CardContent>
              <p className="font-medium text-[var(--foreground)]">
                {projections.lastBookFinished.title}
              </p>
              <p className="text-sm text-[var(--foreground-secondary)]">
                by {projections.lastBookFinished.author}
              </p>
              <p className="text-xs text-[var(--foreground-secondary)] mt-1">
                Finished {new Date(projections.lastBookFinished.finishedAt).toLocaleDateString()}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Link to full Wrapped */}
        <div className="text-center pb-8">
          <Link
            href="/wrapped"
            className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-full font-medium hover:opacity-90 transition-opacity"
          >
            View Full {projections.year} Wrapped
          </Link>
        </div>
      </div>
    </div>
  );
}

function GoalCard({
  goal,
  booksRead,
  onTrack,
  booksNeededPerMonth,
  daysRemaining
}: {
  goal: number;
  booksRead: number;
  onTrack: boolean;
  booksNeededPerMonth: number;
  daysRemaining: number;
}) {
  const progress = Math.min((booksRead / goal) * 100, 100);
  const alreadyAchieved = booksRead >= goal;

  return (
    <div className={`p-4 rounded-xl border ${
      alreadyAchieved
        ? "bg-green-500/10 border-green-500/20"
        : onTrack
        ? "bg-[var(--background-secondary)] border-[var(--border)]"
        : "bg-orange-500/10 border-orange-500/20"
    }`}>
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold text-[var(--foreground)]">{goal} Book Goal</span>
        {alreadyAchieved ? (
          <span className="text-sm text-green-500 font-medium flex items-center gap-1">
            <CheckCircle className="h-4 w-4" />
            Achieved!
          </span>
        ) : onTrack ? (
          <span className="text-sm text-green-500 font-medium">On Track</span>
        ) : (
          <span className="text-sm text-orange-500 font-medium">Need to speed up</span>
        )}
      </div>
      <div className="h-2 bg-[var(--border)] rounded-full overflow-hidden mb-2">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            alreadyAchieved ? "bg-green-500" : "bg-purple-500"
          }`}
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="flex justify-between text-sm">
        <span className="text-[var(--foreground-secondary)]">
          {booksRead} / {goal} books
        </span>
        {!alreadyAchieved && daysRemaining > 0 && (
          <span className="text-[var(--foreground-secondary)]">
            Need {booksNeededPerMonth} books/month
          </span>
        )}
      </div>
    </div>
  );
}
