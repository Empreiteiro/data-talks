/**
 * ChartRenderer – renders a chartSpec (produced by the backend LLM planning step)
 * using Recharts. Replaces the previous matplotlib-generated PNG images.
 */
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface ChartSeries {
  name: string;
  values: number[];
}

export interface ChartSpec {
  chartType: "bar" | "horizontal_bar" | "line" | "pie";
  title: string;
  subtitle?: string;
  xLabel?: string;
  yLabel?: string;
  categories: string[];
  series: ChartSeries[];
  insight?: string;
}

const PALETTE = [
  "#2f80ff",
  "#8b5cf6",
  "#22c55e",
  "#f59e0b",
  "#ef4444",
  "#06b6d4",
];

interface ChartRendererProps {
  spec: ChartSpec;
  className?: string;
}

function buildRechartsData(spec: ChartSpec): Record<string, unknown>[] {
  return spec.categories.map((cat, i) => {
    const row: Record<string, unknown> = { category: cat };
    spec.series.forEach((s) => {
      row[s.name] = s.values[i] ?? 0;
    });
    return row;
  });
}

export function ChartRenderer({ spec, className }: ChartRendererProps) {
  const data = buildRechartsData(spec);
  const multiSeries = spec.series.length > 1;

  const renderLegend = multiSeries || spec.chartType === "pie";

  const commonMargin = { top: 10, right: 20, left: 10, bottom: spec.xLabel ? 30 : 10 };

  let chart: React.ReactNode;

  if (spec.chartType === "pie") {
    const pieData = spec.categories.map((cat, i) => ({
      name: cat,
      value: spec.series[0]?.values[i] ?? 0,
    }));
    chart = (
      <PieChart>
        <Pie
          data={pieData}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          outerRadius="70%"
          label={({ name, percent }) =>
            `${name} ${(percent * 100).toFixed(1)}%`
          }
        >
          {pieData.map((_, idx) => (
            <Cell key={idx} fill={PALETTE[idx % PALETTE.length]} />
          ))}
        </Pie>
        <Tooltip formatter={(value: number) => value.toLocaleString()} />
        {renderLegend && <Legend />}
      </PieChart>
    );
  } else if (spec.chartType === "line") {
    chart = (
      <LineChart data={data} margin={commonMargin}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis
          dataKey="category"
          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
          label={
            spec.xLabel
              ? {
                  value: spec.xLabel,
                  position: "insideBottom",
                  offset: -10,
                  fill: "hsl(var(--muted-foreground))",
                }
              : undefined
          }
        />
        <YAxis
          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
          label={
            spec.yLabel
              ? {
                  value: spec.yLabel,
                  angle: -90,
                  position: "insideLeft",
                  fill: "hsl(var(--muted-foreground))",
                }
              : undefined
          }
        />
        <Tooltip formatter={(value: number) => value.toLocaleString()} />
        {renderLegend && <Legend />}
        {spec.series.map((s, idx) => (
          <Line
            key={s.name}
            type="monotone"
            dataKey={s.name}
            stroke={PALETTE[idx % PALETTE.length]}
            strokeWidth={2.5}
            dot={{ r: 4 }}
            activeDot={{ r: 6 }}
          />
        ))}
      </LineChart>
    );
  } else if (spec.chartType === "horizontal_bar") {
    chart = (
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 10, right: 20, left: 10, bottom: 10 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
        <XAxis
          type="number"
          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
        />
        <YAxis
          type="category"
          dataKey="category"
          width={120}
          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
        />
        <Tooltip formatter={(value: number) => value.toLocaleString()} />
        {renderLegend && <Legend />}
        {spec.series.map((s, idx) =>
          multiSeries ? (
            <Bar key={s.name} dataKey={s.name} fill={PALETTE[idx % PALETTE.length]} radius={[0, 3, 3, 0]} />
          ) : (
            <Bar key={s.name} dataKey={s.name} radius={[0, 3, 3, 0]}>
              {data.map((_, i) => (
                <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
              ))}
            </Bar>
          )
        )}
      </BarChart>
    );
  } else {
    // default: bar
    chart = (
      <BarChart data={data} margin={commonMargin}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis
          dataKey="category"
          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
          label={
            spec.xLabel
              ? {
                  value: spec.xLabel,
                  position: "insideBottom",
                  offset: -10,
                  fill: "hsl(var(--muted-foreground))",
                }
              : undefined
          }
        />
        <YAxis
          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
          label={
            spec.yLabel
              ? {
                  value: spec.yLabel,
                  angle: -90,
                  position: "insideLeft",
                  fill: "hsl(var(--muted-foreground))",
                }
              : undefined
          }
        />
        <Tooltip formatter={(value: number) => value.toLocaleString()} />
        {renderLegend && <Legend />}
        {spec.series.map((s, idx) =>
          multiSeries ? (
            <Bar key={s.name} dataKey={s.name} fill={PALETTE[idx % PALETTE.length]} radius={[3, 3, 0, 0]} />
          ) : (
            <Bar key={s.name} dataKey={s.name} radius={[3, 3, 0, 0]}>
              {data.map((_, i) => (
                <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
              ))}
            </Bar>
          )
        )}
      </BarChart>
    );
  }

  return (
    <div className={`rounded-lg border border-border/60 bg-muted/30 p-4 ${className ?? ""}`}>
      <div className="mb-2">
        <p className="text-sm font-semibold text-foreground">{spec.title}</p>
        {spec.subtitle && (
          <p className="text-xs text-muted-foreground">{spec.subtitle}</p>
        )}
      </div>
      <ResponsiveContainer width="100%" height={320}>
        {chart as React.ReactElement}
      </ResponsiveContainer>
      {spec.insight && (
        <p className="mt-2 text-xs text-muted-foreground italic line-clamp-2">
          {spec.insight}
        </p>
      )}
    </div>
  );
}
