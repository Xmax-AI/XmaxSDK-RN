//
//  RealtimeTiming.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxLogger } from '../../Foundation/Logging/XmaxLogger';
import { XmaxLoggerOption } from '../../Foundation/Logging/XmaxLoggerOption';
import { monotonicTime } from '../../Foundation/Runtime/MonotonicTime';
import { XmaxError, XmaxErrorCode } from '../../Foundation/Errors/XmaxError';

/**
 * The monotonic interval for an observed startup stage, in seconds.
 */
interface StageTiming {

  /**
   * The stage start time.
   */
  startedAt: number | null;

  /**
   * The observed completion time.
   */
  finishedAt: number | null;
}

/**
 * Records the durations of realtime generation startup stages.
 *
 * Missing stages remain unavailable. Cancellation is not logged as startup failure, and sensitive
 * error bodies are excluded from timing summaries.
 */
export class RealtimeTiming {

  /**
   * The startup request's monotonic start time, in seconds.
   */
  private startedAt: number | null = null;

  /**
   * The measured generation task, used to reject unrelated frame notifications.
   */
  private taskID: string | null = null;

  /**
   * Whether this startup has already emitted its final summary.
   */
  private finished = false;

  /**
   * The observed startup intervals.
   */
  private stages: Record<
    'session' | 'room' | 'publication' | 'frame',
    StageTiming
  > = this.makeStages();

  /**
   * Creates a startup timer using a monotonic clock.
   */
  constructor(
    /**
     * The monotonic time source, in seconds.
     */
    private readonly now: () => number = monotonicTime,
  ) {}

  /**
   * Begins a new startup measurement.
   */
  begin(): void {
    this.startedAt = this.now();
    this.stages = this.makeStages();
    this.taskID = null;
    this.finished = false;
  }

  /**
   * Clears startup measurement when its connection resources are released.
   */
  reset(): void {
    this.startedAt = null;
    this.taskID = null;
  }

  /**
   * Records the start of server session creation.
   */
  beginSessionCreation(): void {
    if (this.startedAt !== null && this.stages.session.startedAt === null)
      this.stages.session.startedAt = this.now();
  }

  /**
   * Records the completion of server session creation.
   */
  finishSessionCreation(): void {
    if (this.startedAt !== null && this.stages.session.finishedAt === null)
      this.stages.session.finishedAt = this.now();
  }

  /**
   * Records the start of RTC room join.
   */
  beginRoomJoin(): void {
    if (this.startedAt !== null && this.stages.room.startedAt === null)
      this.stages.room.startedAt = this.now();
  }

  /**
   * Records the completion of RTC room join.
   */
  finishRoomJoin(): void {
    if (this.startedAt !== null && this.stages.room.finishedAt === null)
      this.stages.room.finishedAt = this.now();
  }

  /**
   * Records the start of local video publication.
   */
  beginLocalPublication(): void {
    if (this.startedAt !== null && this.stages.publication.startedAt === null)
      this.stages.publication.startedAt = this.now();
  }

  /**
   * Records the completion of local video publication.
   */
  finishLocalPublication(): void {
    if (this.startedAt !== null && this.stages.publication.finishedAt === null)
      this.stages.publication.finishedAt = this.now();
  }

  /**
   * Records when generation signaling begins for a task.
   *
   * @param taskID The identifier of the measured generation task.
   */
  beginSignal(
    taskID: string
  ): void {
    this.taskID = taskID;
    this.stages.frame = { startedAt: this.now(), finishedAt: null };
  }

  /**
   * Records when the first decoded result frame becomes ready for the measured task.
   *
   * @param taskID The task associated with the current result stream.
   */
  finishFirstFrame(
    taskID: string
  ): void {
    if (taskID === this.taskID && this.stages.frame.finishedAt === null)
      this.stages.frame.finishedAt = this.now();
  }

  /**
   * Logs startup completion once generation is confirmed and its first frame is ready.
   *
   * @param taskID The confirmed generation task.
   */
  finish(
    taskID: string
  ): void {
    if (
      this.finished ||
      this.startedAt === null ||
      this.taskID !== taskID ||
      this.stages.frame.finishedAt === null
    )
      return;
    this.finished = true;
    XmaxLogger.realtime.info(
      () =>
        [
          '实时生成启动耗时 (Realtime Generation Startup Timing)',
          `└─ ${XmaxLogger.localized('总耗时：', 'Total Duration: ')}${this.duration(this.startedAt, this.now())}`,
          ...this.stageDetails(),
        ].join('\n'),
      XmaxLoggerOption.performance,
    );
  }

  /**
   * Logs elapsed startup time, the pending stage, and the SDK error code.
   *
   * @param error The failure that prevented generation startup.
   */
  finishFailure(
    error: unknown
  ): void {
    const failure = XmaxError.from(error);
    if (
      failure.code === XmaxErrorCode.cancelled ||
      this.finished ||
      this.startedAt === null
    )
      return;
    this.finished = true;
    const failedAt = this.now();
    XmaxLogger.realtime.info(
      () =>
        [
          '实时生成启动未完成耗时 (Incomplete Realtime Generation Startup Timing)',
          `├─ ${XmaxLogger.localized('已耗时：', 'Elapsed Time: ')}${this.duration(this.startedAt, failedAt)}`,
          ...this.stageDetails(failedAt),
          `├─ ${XmaxLogger.localized('停留阶段：', 'Current Stage: ')}${this.pendingStage()}`,
          `└─ ${XmaxLogger.localized('失败原因：', 'Failure Reason: ')}${
            failure.code
          }`,
        ].join('\n'),
      XmaxLoggerOption.performance,
    );
  }

  /**
   * Creates empty intervals for the startup stages.
   *
   * @returns The stage timestamps without inferred durations.
   */
  private makeStages(): typeof this.stages {
    return {
      session: { startedAt: null, finishedAt: null },
      room: { startedAt: null, finishedAt: null },
      publication: { startedAt: null, finishedAt: null },
      frame: { startedAt: null, finishedAt: null },
    };
  }

  /**
   * Formats observed stage durations using the current log language.
   *
   * @param failureAt The failure time used to bound unfinished stages.
   * @returns The formatted stage lines; missing intervals use an em dash.
   */
  private stageDetails(
    failureAt?: number
  ): string[] {
    const labels = [
      XmaxLogger.localized(
        '创建会话：',
        'Session Creation: '
      ),
      XmaxLogger.localized(
        'RTC 进房：',
        'RTC Room Join: '
      ),
      XmaxLogger.localized(
        '发布本地流：',
        'Local Stream Publication: '
      ),
      XmaxLogger.localized(
        '首帧到达：',
        'First Frame Arrival: '
      ),
    ];
    return Object.values(this.stages).map(
      (stage, index) =>
        `${failureAt === undefined ? '   ' : '│  '}${
          index === 3 ? '└─' : '├─'
        } ${labels[index]}${this.duration(stage.startedAt, stage.finishedAt ?? failureAt ?? null)}`,
    );
  }

  /**
   * Resolves the pending startup stage from actual observations.
   *
   * @returns The current stage in the configured log language.
   */
  private pendingStage(): string {
    if (this.stages.frame.finishedAt !== null)
      return XmaxLogger.localized(
        '首帧已就绪，正在完成启动',
        'First Frame Ready, Completing Startup',
      );
    if (this.stages.frame.startedAt !== null)
      return XmaxLogger.localized(
        '等待首帧到达',
        'Waiting for First Frame'
      );
    if (this.stages.publication.finishedAt !== null)
      return XmaxLogger.localized(
        '准备生成',
        'Preparing Generation'
      );
    if (this.stages.room.finishedAt !== null)
      return XmaxLogger.localized(
        '发布本地流',
        'Publishing Local Stream'
      );
    if (this.stages.room.startedAt !== null)
      return XmaxLogger.localized(
        'RTC 进房',
        'Joining RTC Room'
      );
    if (this.stages.session.finishedAt !== null)
      return XmaxLogger.localized(
        'RTC 连接准备',
        'RTC Connection Setup'
      );
    if (this.stages.session.startedAt !== null)
      return XmaxLogger.localized(
        '创建会话',
        'Creating Session'
      );
    return XmaxLogger.localized(
      '调用与本地准备',
      'Invocation and Local Preparation',
    );
  }

  /**
   * Formats a monotonic interval in milliseconds.
   *
   * @param start The interval's start time, in seconds.
   * @param end The interval's completion time, in seconds.
   * @returns Milliseconds with one decimal place, or an em dash for missing or reversed timestamps.
   */
  private duration(
    start: number | null,
    end: number | null
  ): string {
    return start === null || end === null || end < start
      ? '—'
      : `${((end - start) * 1000).toFixed(1)} ms`;
  }
}
