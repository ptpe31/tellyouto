import React from 'react';
import { LayoutAnimation, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from 'react-native-paper';
import type { MD3Theme } from 'react-native-paper/lib/typescript/types';

import type { TrankilV2TimelineItemRow } from '../api/trankilV2Db';
import type { ProjectMilestone } from '../services/projectMilestonesModel';
import { categoryPastelTabBackground } from '../utils/categoryPastel';
import {
  buildTravelProjectInboxProgress,
  type TravelMilestoneInboxState,
} from '../utils/travelProjectInboxProgress';
import { buildZoomJalonKey, type ZoomInboxView } from '../utils/zoomInboxModel';
import { InboxLineTitle } from './InboxLineTitle';
import { PressableScale } from './common/PressableScale';

const ZOOM_TASK_CHECKBOX_SIZE = 22;
const TRAVEL_MILESTONE_INSET = 24 + 34 + 8;
const ZOOM_PANEL_EXTRA_INSET = 8;

function formatMilestoneDurationLabel(m: ProjectMilestone): string {
  const toShort = (unit: string) => (unit === 'hours' ? 'h' : unit === 'weeks' ? 'sem' : 'j');
  return `+${m.estimated_duration}${toShort(m.unit)}`;
};

type Props = {
  projectRow: TrankilV2TimelineItemRow;
  milestones: ProjectMilestone[];
  inboxZoomView?: ZoomInboxView;
  resolveRow: (row: TrankilV2TimelineItemRow) => TrankilV2TimelineItemRow;
  expandedZoomJalonKeys: Set<string>;
  expandedZoomDoneJalonKeys: Set<string>;
  travelDoneExpanded: boolean;
  onToggleZoomJalon: (jalonKey: string) => void;
  onToggleZoomDoneSection: (jalonKey: string) => void;
  onToggleTravelDoneSection: () => void;
  onToggleMilestoneDone: (milestoneUid: string) => void;
  onToggleZoomTaskDone: (task: TrankilV2TimelineItemRow) => void;
  onOpenProjectDetail: () => void;
  onOpenTaskDetail: (task: TrankilV2TimelineItemRow) => void;
  textPrimary: string;
  textSecondary: string;
  accentColor: string;
  locale: string;
  theme: MD3Theme;
  t: (key: string, options?: Record<string, unknown>) => string;
};

function ZoomTaskCheckbox(props: {
  checked: boolean;
  onPress: () => void;
  a11yLabel: string;
  outlineColor: string;
  disabled?: boolean;
}) {
  const { checked, onPress, a11yLabel, outlineColor, disabled = false } = props;
  return (
    <PressableScale
      style={[styles.zoomTaskCheckboxHit, disabled ? styles.zoomTaskCheckboxDisabled : null]}
      hapticType="light"
      onPress={disabled ? undefined : onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      accessibilityLabel={a11yLabel}
    >
      <View
        style={[
          styles.zoomTaskCheckboxBox,
          { borderColor: checked ? '#16a34a' : outlineColor },
          checked ? styles.zoomTaskCheckboxBoxChecked : null,
        ]}
      >
        {checked ? <Icon source="check" size={14} color="#ffffff" /> : null}
      </View>
    </PressableScale>
  );
}

function renderZoomTaskRow(params: {
  child: TrankilV2TimelineItemRow;
  childDone: boolean;
  isLastChild: boolean;
  onToggle: () => void;
  onOpenDetail: () => void;
  textPrimary: string;
  textSecondary: string;
  locale: string;
  outlineColor: string;
  t: Props['t'];
}) {
  const { child, childDone, isLastChild, onToggle, onOpenDetail, textPrimary, textSecondary, locale, outlineColor, t } =
    params;
  return (
    <View key={child.id} style={[styles.zoomPanelChildRow, isLastChild ? styles.zoomPanelChildRowLast : null]}>
      <ZoomTaskCheckbox
        checked={childDone}
        onPress={onToggle}
        outlineColor={outlineColor}
        a11yLabel={
          childDone
            ? t('timeline.a11yTaskUncomplete', { defaultValue: 'Marquer non fait' })
            : t('timeline.a11yTaskComplete')
        }
      />
      <View style={styles.zoomConnectorCol}>
        <View
          style={[
            styles.zoomConnectorV,
            isLastChild ? styles.zoomConnectorVLast : null,
            { backgroundColor: outlineColor },
          ]}
        />
        <View style={[styles.zoomConnectorH, { backgroundColor: outlineColor }]} />
      </View>
      <PressableScale style={styles.zoomTaskDetailPressable} hapticType="light" onPress={onOpenDetail}>
        <InboxLineTitle
          row={child}
          textPrimary={textPrimary}
          textSecondary={textSecondary}
          locale={locale}
          hidePastille
          titleDone={childDone}
          titleLines={2}
          hideLine2
          omitNewBadge
        />
      </PressableScale>
    </View>
  );
}

function MilestoneBlock(props: {
  milestone: ProjectMilestone;
  projectRow: TrankilV2TimelineItemRow;
  inboxZoomView?: ZoomInboxView;
  resolveRow: (row: TrankilV2TimelineItemRow) => TrankilV2TimelineItemRow;
  msState: TravelMilestoneInboxState;
  expandedZoomJalonKeys: Set<string>;
  expandedZoomDoneJalonKeys: Set<string>;
  onToggleZoomJalon: (jalonKey: string) => void;
  onToggleZoomDoneSection: (jalonKey: string) => void;
  onToggleMilestoneDone: (milestoneUid: string) => void;
  onToggleZoomTaskDone: (task: TrankilV2TimelineItemRow) => void;
  onOpenProjectDetail: () => void;
  onOpenTaskDetail: (task: TrankilV2TimelineItemRow) => void;
  textPrimary: string;
  textSecondary: string;
  accentColor: string;
  locale: string;
  theme: MD3Theme;
  t: Props['t'];
  doneSection?: boolean;
}) {
  const {
    milestone,
    projectRow,
    inboxZoomView,
    resolveRow,
    msState,
    expandedZoomJalonKeys,
    expandedZoomDoneJalonKeys,
    onToggleZoomJalon,
    onToggleZoomDoneSection,
    onToggleMilestoneDone,
    onToggleZoomTaskDone,
    onOpenProjectDetail,
    onOpenTaskDetail,
    textPrimary,
    textSecondary,
    accentColor,
    locale,
    theme,
    t,
    doneSection,
  } = props;

  const jalonKey = milestone.uid ? buildZoomJalonKey(projectRow.id, milestone.uid) : null;
  const zoomTasks =
    jalonKey && inboxZoomView ? inboxZoomView.childrenByJalonKey.get(jalonKey) ?? [] : [];
  const resolvedZoomTasks = zoomTasks.map((task) => resolveRow(task));
  const todoTasks = resolvedZoomTasks.filter((task) => task.status !== 'DONE');
  const doneTasks = resolvedZoomTasks.filter((task) => task.status === 'DONE');
  const hasZoomDecompose = msState.hasDecompose;
  const zoomJalonExpanded = jalonKey ? expandedZoomJalonKeys.has(jalonKey) : false;
  const zoomDoneSectionExpanded =
    jalonKey && (expandedZoomDoneJalonKeys.has(jalonKey) || doneTasks.length < 2);
  const milestoneChecked = msState.milestoneChecked;
  const sublineParts: string[] = [formatMilestoneDurationLabel(milestone)];
  const persona = String(milestone.expert_persona ?? '').trim();
  if (persona) sublineParts.push(persona);
  const subline = sublineParts.join(' · ');
  const categoryPastel = categoryPastelTabBackground(projectRow.category_id);
  const zoomProgressRatio =
    msState.zoomTotal > 0 ? Math.min(1, msState.zoomDone / msState.zoomTotal) : 0;
  const showMilestoneCheckbox = msState.showMilestoneCheckbox && !doneSection;
  const milestoneCheckboxEnabled = msState.milestoneCheckboxEnabled && !doneSection;

  const onMilestoneBodyPress = () => {
    if (hasZoomDecompose && jalonKey && !doneSection) {
      onToggleZoomJalon(jalonKey);
    } else {
      onOpenProjectDetail();
    }
  };

  return (
    <React.Fragment key={milestone.uid || `${projectRow.id}-${milestone.title}`}>
      <View style={[styles.milestoneRow, { paddingLeft: TRAVEL_MILESTONE_INSET }]}>
        {showMilestoneCheckbox ? (
          <ZoomTaskCheckbox
            checked={milestoneChecked}
            disabled={!milestoneCheckboxEnabled}
            onPress={() => onToggleMilestoneDone(milestone.uid)}
            outlineColor={theme.colors.outline}
            a11yLabel={
              milestoneChecked
                ? t('timeline.a11yTaskUncomplete', { defaultValue: 'Marquer non fait' })
                : t('timeline.a11yTaskComplete')
            }
          />
        ) : null}
        <PressableScale
          style={styles.milestoneBody}
          hapticType="light"
          onPress={onMilestoneBodyPress}
          accessibilityRole="button"
          accessibilityLabel={milestone.title}
        >
          <Text
            style={[
              styles.rowTitle,
              { color: textPrimary },
              milestoneChecked ? styles.rowTitleDone : null,
            ]}
            numberOfLines={1}
          >
            {milestone.title}
          </Text>
          <View style={styles.milestoneSublineRow}>
            <Text
              style={[styles.createdHint, styles.milestoneSublineText, { color: textSecondary }]}
              numberOfLines={1}
            >
              {subline}
            </Text>
            {hasZoomDecompose && !doneSection ? (
              <>
                <View style={[styles.zoomJalonCountBadge, { backgroundColor: categoryPastel }]}>
                  <Text style={[styles.zoomJalonCountText, { color: textPrimary }]}>
                    {msState.zoomDone}/{msState.zoomTotal}
                  </Text>
                </View>
                <Icon
                  source={zoomJalonExpanded ? 'chevron-left' : 'chevron-right'}
                  size={20}
                  color={textSecondary}
                />
              </>
            ) : null}
          </View>
        </PressableScale>
      </View>

      {hasZoomDecompose && zoomJalonExpanded && !doneSection ? (
        <View
          style={[
            styles.zoomDecomposeWrap,
            { marginLeft: TRAVEL_MILESTONE_INSET + ZOOM_PANEL_EXTRA_INSET, marginRight: 12 },
          ]}
        >
          <View style={styles.zoomDecomposeStemCol}>
            <View style={[styles.zoomDecomposeStemLine, { backgroundColor: theme.colors.outlineVariant }]} />
          </View>
          <View
            style={[
              styles.zoomDecomposePanel,
              { backgroundColor: categoryPastel, borderColor: theme.colors.outlineVariant },
            ]}
          >
            <View style={[styles.zoomProgressTrack, { backgroundColor: `${textSecondary}22` }]}>
              <View
                style={[
                  styles.zoomProgressFill,
                  { width: `${Math.round(zoomProgressRatio * 100)}%`, backgroundColor: accentColor },
                ]}
              />
            </View>
            {todoTasks.map((childSource, childIndex) => {
              const child = resolveRow(childSource);
              return renderZoomTaskRow({
                child,
                childDone: false,
                isLastChild: childIndex === todoTasks.length - 1 && doneTasks.length === 0,
                onToggle: () => onToggleZoomTaskDone(child),
                onOpenDetail: () => onOpenTaskDetail(child),
                textPrimary,
                textSecondary,
                locale,
                outlineColor: theme.colors.outline,
                t,
              });
            })}
            {doneTasks.length > 0 ? (
              <>
                <Pressable
                  style={styles.zoomDoneSectionHeader}
                  onPress={() => jalonKey && onToggleZoomDoneSection(jalonKey)}
                  accessibilityRole="button"
                >
                  <Text style={[styles.zoomDoneSectionLabel, { color: textSecondary }]}>
                    {t('timeline.inboxZoomDoneSection', {
                      count: doneTasks.length,
                      defaultValue: `Terminé (${doneTasks.length})`,
                    })}
                  </Text>
                  <Icon
                    source={zoomDoneSectionExpanded ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={textSecondary}
                  />
                </Pressable>
                {zoomDoneSectionExpanded
                  ? doneTasks.map((childSource, childIndex) => {
                      const child = resolveRow(childSource);
                      return renderZoomTaskRow({
                        child,
                        childDone: true,
                        isLastChild: childIndex === doneTasks.length - 1,
                        onToggle: () => onToggleZoomTaskDone(child),
                        onOpenDetail: () => onOpenTaskDetail(child),
                        textPrimary,
                        textSecondary,
                        locale,
                        outlineColor: theme.colors.outline,
                        t,
                      });
                    })
                  : null}
              </>
            ) : null}
          </View>
        </View>
      ) : null}
    </React.Fragment>
  );
}

export function TravelMilestoneInboxRows(props: Props) {
  const {
    projectRow,
    milestones,
    inboxZoomView,
    resolveRow,
    expandedZoomJalonKeys,
    expandedZoomDoneJalonKeys,
    travelDoneExpanded,
    onToggleZoomJalon,
    onToggleZoomDoneSection,
    onToggleTravelDoneSection,
    onToggleMilestoneDone,
    onToggleZoomTaskDone,
    onOpenProjectDetail,
    onOpenTaskDetail,
    textPrimary,
    textSecondary,
    accentColor,
    locale,
    theme,
    t,
  } = props;

  const progress = buildTravelProjectInboxProgress({
    milestones,
    projectId: projectRow.id,
    zoomView: inboxZoomView,
    resolveTaskRow: resolveRow,
  });

  const activeMilestones = milestones.filter((m) => !Boolean(m.checked));
  const doneMilestones = milestones.filter((m) => Boolean(m.checked));

  return (
    <>
      {activeMilestones.map((milestone) => {
        const msState = progress.byUid.get(milestone.uid);
        if (!msState) return null;
        return (
          <MilestoneBlock
            key={milestone.uid}
            milestone={milestone}
            projectRow={projectRow}
            inboxZoomView={inboxZoomView}
            resolveRow={resolveRow}
            msState={msState}
            expandedZoomJalonKeys={expandedZoomJalonKeys}
            expandedZoomDoneJalonKeys={expandedZoomDoneJalonKeys}
            onToggleZoomJalon={onToggleZoomJalon}
            onToggleZoomDoneSection={onToggleZoomDoneSection}
            onToggleMilestoneDone={onToggleMilestoneDone}
            onToggleZoomTaskDone={onToggleZoomTaskDone}
            onOpenProjectDetail={onOpenProjectDetail}
            onOpenTaskDetail={onOpenTaskDetail}
            textPrimary={textPrimary}
            textSecondary={textSecondary}
            accentColor={accentColor}
            locale={locale}
            theme={theme}
            t={t}
          />
        );
      })}
      {doneMilestones.length > 0 ? (
        <>
          <Pressable
            style={[styles.travelDoneSectionHeader, { paddingLeft: TRAVEL_MILESTONE_INSET }]}
            onPress={() => {
              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
              onToggleTravelDoneSection();
            }}
            accessibilityRole="button"
          >
            <View style={[styles.travelDoneDivider, { backgroundColor: theme.colors.outlineVariant }]} />
            <Text style={[styles.travelDoneSectionLabel, { color: textSecondary }]}>
              {t('timeline.inboxTravelDoneSection', {
                count: doneMilestones.length,
                defaultValue: `Terminé (${doneMilestones.length})`,
              })}
            </Text>
            <Icon
              source={travelDoneExpanded ? 'chevron-up' : 'chevron-down'}
              size={18}
              color={textSecondary}
            />
          </Pressable>
          {travelDoneExpanded
            ? doneMilestones.map((milestone) => {
                const msState = progress.byUid.get(milestone.uid);
                if (!msState) return null;
                return (
                  <MilestoneBlock
                    key={milestone.uid}
                    milestone={milestone}
                    projectRow={projectRow}
                    inboxZoomView={inboxZoomView}
                    resolveRow={resolveRow}
                    msState={msState}
                    expandedZoomJalonKeys={expandedZoomJalonKeys}
                    expandedZoomDoneJalonKeys={expandedZoomDoneJalonKeys}
                    onToggleZoomJalon={onToggleZoomJalon}
                    onToggleZoomDoneSection={onToggleZoomDoneSection}
                    onToggleMilestoneDone={onToggleMilestoneDone}
                    onToggleZoomTaskDone={onToggleZoomTaskDone}
                    onOpenProjectDetail={onOpenProjectDetail}
                    onOpenTaskDetail={onOpenTaskDetail}
                    textPrimary={textPrimary}
                    textSecondary={textSecondary}
                    accentColor={accentColor}
                    locale={locale}
                    theme={theme}
                    t={t}
                    doneSection
                  />
                );
              })
            : null}
        </>
      ) : null}
    </>
  );
}

export function resolveTravelProjectBadgeLabel(params: {
  milestones: ProjectMilestone[];
  projectId: string;
  inboxZoomView?: ZoomInboxView;
  resolveRow: (row: TrankilV2TimelineItemRow) => TrankilV2TimelineItemRow;
  fallbackCount: number;
}): string {
  const progress = buildTravelProjectInboxProgress({
    milestones: params.milestones,
    projectId: params.projectId,
    zoomView: params.inboxZoomView,
    resolveTaskRow: params.resolveRow,
  });
  if (progress.totalSteps <= 0) return `+${params.fallbackCount}`;
  return `${progress.doneSteps}/${progress.totalSteps}`;
}

const styles = StyleSheet.create({
  milestoneRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 8,
    paddingRight: 12,
  },
  milestoneBody: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: { fontSize: 15, fontWeight: '600' },
  rowTitleDone: { textDecorationLine: 'line-through', opacity: 0.72 },
  createdHint: { fontSize: 11, marginTop: 4 },
  milestoneSublineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 4,
  },
  milestoneSublineText: { flex: 1 },
  zoomJalonCountBadge: {
    minWidth: 28,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  zoomJalonCountText: { fontSize: 11, fontWeight: '800', lineHeight: 13 },
  zoomDecomposeWrap: { flexDirection: 'row', alignItems: 'stretch', marginBottom: 8 },
  zoomDecomposeStemCol: { width: 14, alignItems: 'center', paddingTop: 4 },
  zoomDecomposeStemLine: { width: StyleSheet.hairlineWidth, flex: 1, minHeight: 12, borderRadius: 1 },
  zoomDecomposePanel: {
    flex: 1,
    minWidth: 0,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    marginBottom: 4,
  },
  zoomProgressTrack: { height: 2, width: '100%', overflow: 'hidden' },
  zoomProgressFill: { height: 2 },
  zoomPanelChildRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  zoomPanelChildRowLast: { borderBottomWidth: 0 },
  zoomTaskCheckboxHit: { flexShrink: 0, marginTop: 1 },
  zoomTaskCheckboxDisabled: { opacity: 0.45 },
  zoomTaskCheckboxBox: {
    width: ZOOM_TASK_CHECKBOX_SIZE,
    height: ZOOM_TASK_CHECKBOX_SIZE,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  zoomTaskCheckboxBoxChecked: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  zoomConnectorCol: {
    width: 16,
    height: ZOOM_TASK_CHECKBOX_SIZE,
    position: 'relative',
    marginTop: 1,
    flexShrink: 0,
  },
  zoomConnectorV: { position: 'absolute', left: 7, top: -10, bottom: 0, width: StyleSheet.hairlineWidth },
  zoomConnectorVLast: { bottom: '50%' },
  zoomConnectorH: {
    position: 'absolute',
    left: 7,
    top: 10,
    width: 9,
    height: StyleSheet.hairlineWidth,
  },
  zoomTaskDetailPressable: { flex: 1, minWidth: 0 },
  zoomDoneSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.08)',
  },
  zoomDoneSectionLabel: { fontSize: 11, fontWeight: '700' },
  travelDoneSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingRight: 12,
    marginTop: 4,
  },
  travelDoneDivider: { flex: 1, height: StyleSheet.hairlineWidth },
  travelDoneSectionLabel: { fontSize: 11, fontWeight: '700', flexShrink: 0 },
});
