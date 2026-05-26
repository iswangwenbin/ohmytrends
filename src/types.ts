export type Source = "baidu" | "google";
export type SourceOption = Source | "all";
export type OutputFormat = "table" | "json";
export type TerminalLanguage = "zh" | "en";
export type BaiduCollectMode = "page" | "api";

export type SearchIndexResponse = {
  status?: number;
  data?: {
    userIndexes?: RawSearchIndexGroup[];
    index?: RawFeedIndexGroup[];
    uniqid?: string;
  };
  message?: string;
};

export type RawSearchIndexGroup = {
  word: string | { name?: string }[];
  all?: RawIndexSeries;
  pc?: RawIndexSeries;
  wise?: RawIndexSeries;
};

export type RawFeedIndexGroup = {
  key: string | { name?: string }[];
  startDate: string;
  endDate: string;
  data: string;
};

export type RawIndexGroup = RawSearchIndexGroup | RawFeedIndexGroup;

export type RawIndexSeries = {
  startDate: string;
  endDate: string;
  data: string;
};

export type IndexPoint = {
  date: string;
  all: number | null;
  pc: number | null;
  wise: number | null;
};

export type KeywordTrend = {
  word: string;
  points: IndexPoint[];
};

export type RelatedQuery = {
  query: string;
  value: number | null;
  formattedValue: string;
  link?: string;
};

export type RelatedQueries = {
  top: RelatedQuery[];
  rising: RelatedQuery[];
};

export type BaiduIndexKind = "search" | "feed";

export type BaiduIndexSection = {
  apiUrl: string;
  overview: OverviewRow[];
  trends: KeywordTrend[];
  unavailableWords?: string[];
  raw?: SearchIndexResponse;
  error?: string;
};

export type OverviewRow = {
  keyword: string;
  overallDailyAverage: number | null;
  mobileDailyAverage: number | null;
  overallYearOverYear: ChangeMetric | null;
  overallMonthOverMonth: ChangeMetric | null;
  mobileYearOverYear: ChangeMetric | null;
  mobileMonthOverMonth: ChangeMetric | null;
};

export type ChangeMetric = {
  percent: number | null;
  direction: "up" | "down" | "flat" | null;
};

export type CollectOutput = {
  capturedAt: string;
  source: Source;
  sourceUrl: string;
  apiUrl: string;
  apiUrls?: Partial<Record<BaiduIndexKind, string>>;
  words: string[];
  status: "ok" | "no_data";
  reason?: string;
  overview: OverviewRow[];
  trends: KeywordTrend[];
  relatedQueries?: Record<string, RelatedQueries>;
  indices?: Partial<Record<BaiduIndexKind, BaiduIndexSection>>;
  unavailableWords?: string[];
  raw?: SearchIndexResponse;
  error?: string;
};

export type Options = {
  source: SourceOption;
  lang: TerminalLanguage;
  url: string;
  words: string[];
  profileDir: string;
  out: string;
  format: OutputFormat;
  raw: boolean;
  headless: boolean;
  keepOpen: boolean;
  timeoutMs: number;
  loginTimeoutMs: number;
  startDate?: string;
  endDate?: string;
  days?: number;
  range?: string;
  rangeLabel?: string;
  baiduMode: BaiduCollectMode;
  geo: string;
  area: string;
  onStatus?: (message: string) => void;
  quietStatus?: boolean;
};

export type BrowserContextLike = {
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
  cookies(urls?: string[]): Promise<{ name: string; value: string }[]>;
  pages(): PageLike[];
  addInitScript?(callback: (...args: any[]) => any, arg?: unknown): Promise<unknown>;
  exposeBinding?(
    name: string,
    callback: (source: { page?: PageLike }, payload?: unknown) => unknown | Promise<unknown>,
  ): Promise<unknown>;
  on?(event: string, callback: (...args: any[]) => void | Promise<void>): void;
};

export type PageLike = {
  url(): string;
  isClosed?(): boolean;
  on(event: string, callback: (...args: any[]) => void | Promise<void>): void;
  route(url: string, callback: (route: RouteLike) => void | Promise<void>): Promise<unknown>;
  addInitScript(callback: (...args: any[]) => any, arg?: unknown): Promise<unknown>;
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  waitForSelector(selector: string, options?: { timeout?: number }): Promise<unknown>;
  waitForResponse?(
    predicate: (response: ResponseLike) => boolean | Promise<boolean>,
    options?: { timeout?: number },
  ): Promise<ResponseLike>;
  waitForTimeout(timeout: number): Promise<void>;
  waitForLoadState(state: "domcontentloaded" | "networkidle", options?: { timeout?: number }): Promise<void>;
  mouse: {
    click(x: number, y: number): Promise<void>;
  };
  keyboard: {
    press(key: string): Promise<void>;
    type(text: string, options?: { delay?: number }): Promise<void>;
  };
  locator(selector: string): {
    innerText(options?: { timeout?: number }): Promise<string>;
    click(options?: { timeout?: number }): Promise<void>;
  };
  evaluate<Arg, Result>(
    callback: (arg: Arg) => Result | Promise<Result>,
    arg: Arg,
  ): Promise<Result>;
};

declare global {
  interface Window {
    __ohmytrendsSetStatus?: (text: string) => void;
    __ohmytrendsStatusOverlay?: { render(text: string): void };
    __ohmytrendsShowBaiduLoginGuide?: (message?: string) => void;
    __ohmytrendsHideBaiduLoginGuide?: () => void;
  }
}

export type ResponseLike = {
  url(): string;
  json(): Promise<unknown>;
};

export type RouteLike = {
  request(): RequestLike;
  continue(): Promise<void>;
  abort(): Promise<void>;
  fulfill(response: { status: number; body?: string }): Promise<void>;
};

export type RequestLike = {
  url(): string;
  resourceType(): string;
};
