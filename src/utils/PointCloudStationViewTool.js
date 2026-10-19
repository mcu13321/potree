import {setPointCloudStationHidden} from "./PointCloudLabelAppearance.js";

/** Isolate one scene member without changing source visibility, selection or camera state. */
export class PointCloudStationViewTool {
	constructor(viewer, pointcloud) {
		if (!pointcloud || !viewer.scene.pointclouds.includes(pointcloud)) throw new RangeError("Station must belong to the current scene");
		if (viewer.pointCloudAlignmentTool && !viewer.pointCloudAlignmentTool.disposed) throw new Error("Station viewing is unavailable during alignment");
		this.viewer = viewer;
		this.scene = viewer.scene;
		this.pointcloud = pointcloud;
		this.disposed = false;
		this.hiddenClouds = new Set();
		this.onReconcile = () => this.reconcile();
		viewer.addEventListener("scene_changed", this.onReconcile);
		this.scene.addEventListener("pointcloud_added", this.onReconcile);
		this.scene.addEventListener("pointcloud_removed", this.onReconcile);
		this.reconcile();
	}

	/** Return a snapshot instead of exposing mutable internal membership. */
	getState() { return {running: !this.disposed, pointcloud: this.disposed ? null : this.pointcloud}; }

	/** Scope camera fitting to this target; an ended session no longer owns framing. */
	getPointClouds() { return this.disposed ? null : [this.pointcloud]; }

	/** Update only this instance's visibility ownership, including late-arriving clouds. */
	reconcile() {
		if (this.disposed) return;
		if (this.viewer.scene !== this.scene || !this.scene.pointclouds.includes(this.pointcloud)) {
			this.dispose();
			return;
		}
		const members = new Set(this.scene.pointclouds);
		for (const cloud of this.hiddenClouds) {
			if (!members.has(cloud)) {
				setPointCloudStationHidden(cloud, this, false);
				this.hiddenClouds.delete(cloud);
			}
		}
		for (const cloud of members) {
			if (cloud === this.pointcloud) continue;
			setPointCloudStationHidden(cloud, this, true);
			this.hiddenClouds.add(cloud);
		}
		this.viewer.pointCloudLabelTool?.update();
	}

	/** Publish lifecycle changes after the Viewer reference has been assigned or cleared. */
	dispatchState() { this.viewer.dispatchEvent({type: "pointcloud_station_view_changed", ...this.getState()}); }

	/** Release only this tool's masks and subscriptions; cleanup never reframes the camera. */
	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		for (const cloud of this.hiddenClouds) setPointCloudStationHidden(cloud, this, false);
		this.hiddenClouds.clear();
		this.viewer.removeEventListener("scene_changed", this.onReconcile);
		this.scene.removeEventListener("pointcloud_added", this.onReconcile);
		this.scene.removeEventListener("pointcloud_removed", this.onReconcile);
		if (this.viewer.pointCloudStationViewTool === this) this.viewer.pointCloudStationViewTool = null;
		this.viewer.pointCloudLabelTool?.update();
		this.dispatchState();
	}
}
