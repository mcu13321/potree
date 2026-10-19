import {setPointCloudAlignmentHidden} from "./PointCloudLabelAppearance.js";
import {captureAlignmentPose, beginAlignmentPose, restoreAlignmentPose, endAlignmentPose} from "./PointCloudAlignmentTransform.js";
import {PointCloudAlignmentGizmo} from "./PointCloudAlignmentGizmo.js";

/** Own an opt-in preview transaction and its two-cloud selection without touching geometry. */
export class PointCloudAlignmentTool {
	constructor(viewer) {
		// Direct tool construction follows the same workflow exclusion as the Viewer API.
		if (viewer.pointCloudStationViewTool && !viewer.pointCloudStationViewTool.disposed) throw new Error("Alignment is unavailable during station viewing");
		const labels = viewer.pointCloudLabelTool;
		const primary = labels?.getActivePointCloud();
		if (!primary || !viewer.scene.pointclouds.includes(primary)) throw new Error("Alignment requires an active point cloud");
		this.viewer = viewer;
		this.labels = labels;
		this.scene = viewer.scene;
		this.activePointCloud = primary;
		this.active2PointCloud = null;
		this.phase = "waiting";
		this.disposed = false;
		this.originalPose = captureAlignmentPose(primary);
		beginAlignmentPose(primary, this.originalPose);
		labels.alignmentTool = this;
		setPointCloudAlignmentHidden(primary, true);
		this.gizmo = new PointCloudAlignmentGizmo(this);
		this.onReconcile = () => this.reconcile();
		this.onRebase = () => { this.gizmo.cancelGesture(); this.labels.update(); };
		viewer.addEventListener("scene_changed", this.onReconcile);
		this.scene.addEventListener("pointcloud_removed", this.onReconcile);
		this.scene.addEventListener("pointcloud_offset_changed", this.onRebase);
		this.labels.update();
	}

	/** Return a snapshot suitable for host controls and state-change events. */
	getState() {
		return {phase: this.phase, activePointcloud: this.disposed ? this.labels.getActivePointCloud() : this.activePointCloud, active2Pointcloud: this.active2PointCloud};
	}

	/** A new target always starts from the session entry pose, not the preceding preview. */
	setActive2PointCloud(pointcloud) {
		this.reconcile();
		if (this.disposed) throw new Error("The alignment session has ended");
		if (pointcloud !== null && (pointcloud === this.activePointCloud || !this.scene.pointclouds.includes(pointcloud))) throw new RangeError("Alignment target must be another point cloud in the current scene");
		if (pointcloud === this.active2PointCloud) return this;
		this.restoreOriginal();
		this.active2PointCloud = pointcloud;
		this.phase = pointcloud ? "paired" : "waiting";
		setPointCloudAlignmentHidden(this.activePointCloud, !pointcloud);
		this.labels.update();
		this.dispatchState();
		return this;
	}

	/** Reset completed gestures too when the target or entire transaction is cancelled. */
	restoreOriginal() {
		this.gizmo.cancelGesture();
		const before = captureAlignmentPose(this.activePointCloud).matrix;
		restoreAlignmentPose(this.activePointCloud, this.originalPose);
		if (!before.equals(this.activePointCloud.matrix)) this.dispatchTransform("reset", "cancel");
	}

	/** Publish transform snapshots by value so subscribers cannot mutate the live object. */
	dispatchTransform(operation, stage) {
		this.activePointCloud.updateWorldMatrix(true, false);
		this.viewer.dispatchEvent({type: "pointcloud_alignment_transform_changed", pointcloud: this.activePointCloud, operation, stage, matrix: this.activePointCloud.matrix.clone(), matrixWorld: this.activePointCloud.matrixWorld.clone()});
	}

	/** Publish secondary changes independently of the original active-point-cloud event. */
	dispatchState() { this.viewer.dispatchEvent({type: "pointcloud_alignment_changed", ...this.getState()}); }

	/** Reconcile before label cleanup, restoring edits before releasing the selection lock. */
	reconcile() {
		if (this.disposed) return;
		if (this.viewer.scene !== this.scene || this.labels.disposed || !this.scene.pointclouds.includes(this.activePointCloud)) {
			this.dispose(false);
		} else if (this.active2PointCloud && !this.scene.pointclouds.includes(this.active2PointCloud)) {
			// Clear membership first because cancelling a pointer can synchronously update labels.
			this.active2PointCloud = null;
			this.phase = "waiting";
			this.restoreOriginal();
			setPointCloudAlignmentHidden(this.activePointCloud, true);
			this.dispatchState();
		}
	}

	/** Confirm only a valid pair; the host remains responsible for its exit camera reset. */
	commit() {
		this.reconcile();
		if (this.disposed || !this.active2PointCloud) return false;
		this.gizmo.finishGesture(false);
		this.close(true);
		return true;
	}

	/** Explicit cancellation and lifecycle disposal both restore the entry transform. */
	cancel() {
		if (this.disposed) return false;
		this.close(false);
		return true;
	}

	/** Keep the existing internal updateLabels argument used by scene and label cleanup. */
	dispose(updateLabels = true) { this.close(false, updateLabels); }

	/** Close exactly once, including native pointer ownership, previews and all subscriptions. */
	close(committed, updateLabels = true) {
		if (this.disposed) return;
		this.disposed = true;
		this.gizmo.dispose();
		if (!committed) this.restoreOriginal();
		endAlignmentPose(this.activePointCloud, committed);
		this.phase = "idle";
		this.active2PointCloud = null;
		setPointCloudAlignmentHidden(this.activePointCloud, false);
		if (this.labels.alignmentTool === this) this.labels.alignmentTool = null;
		if (this.viewer.pointCloudAlignmentTool === this) this.viewer.pointCloudAlignmentTool = null;
		this.viewer.removeEventListener("scene_changed", this.onReconcile);
		this.scene.removeEventListener("pointcloud_removed", this.onReconcile);
		this.scene.removeEventListener("pointcloud_offset_changed", this.onRebase);
		if (updateLabels && !this.labels.disposed) this.labels.update();
		this.dispatchState();
	}
}
