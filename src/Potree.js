
export * from "./Actions.js";
export * from "./AnimationPath.js";
export * from "./Annotation.js";
export * from "./defines.js";
export * from "./Enum.js";
export * from "./EventDispatcher.js";
export * from "./Features.js";
export * from "./KeyCodes.js";
export * from "./LRU.js";
export * from "./PointCloudEptGeometry.js";
export * from "./PointCloudOctree.js";
export * from "./PointCloudOctreeGeometry.js";
export * from "./PointCloudTree.js";
export * from "./Points.js";
export * from "./Potree_update_visibility.js";
export * from "./PotreeRenderer.js";
export * from "./ProfileRequest.js";
export * from "./TextSprite.js";
export * from "./utils.js";
export * from "./Version.js";
export * from "./WorkerPool.js";
export * from "./XHRFactory.js";
export * from "./viewer/SaveProject.js";
export * from "./viewer/LoadProject.js";

export * from "./materials/ClassificationScheme.js";
export * from "./materials/EyeDomeLightingMaterial.js";
export * from "./materials/Gradients.js";
export * from "./materials/NormalizationEDLMaterial.js";
export * from "./materials/NormalizationMaterial.js";
export * from "./materials/PointCloudMaterial.js";

export * from "./loader/POCLoader.js";
export * from "./modules/loader/2.0/OctreeLoader.js";
export * from "./loader/EptLoader.js";
export * from "./loader/ept/BinaryLoader.js";
export * from "./loader/ept/LaszipLoader.js";
export * from "./loader/ept/ZstandardLoader.js";
export * from "./loader/PointAttributes.js";
export * from "./loader/ShapefileLoader.js";
export * from "./loader/GeoPackageLoader.js";

export * from "./utils/Box3Helper.js";
export * from "./utils/ClippingTool.js";
export * from "./utils/ClipVolume.js";
export * from "./utils/GeoTIFF.js";
export * from "./utils/Measure.js";
export * from "./utils/MeasureMagnifier.js";
export * from "./utils/MeasuringTool.js";
export * from "./utils/Message.js";
export * from "./utils/PointCloudSM.js";
export * from "./utils/PolygonClipVolume.js";
export * from "./utils/Profile.js";
export * from "./utils/ProfileTool.js";
export * from "./utils/ScreenBoxSelectTool.js";
export * from "./utils/SpotLightHelper.js";
export * from "./utils/TransformationTool.js";
export * from "./utils/Volume.js";
export * from "./utils/VolumeTool.js";
export * from "./utils/TreeTag.js";
export * from "./utils/TreeTagTool.js";
export * from "./utils/CadVector.js";
export * from "./utils/CadVectorTool.js";
export * from "./utils/CrossSectionPreviewTool.js";
export * from "./utils/AxisLineMarker.js";
export * from "./utils/AxisLineMarkerTool.js";
export * from "./utils/TrackPointTool.js";
export * from "./utils/Compass.js";
export * from "./utils/RectangleSVGTool.js";
export * from "./utils/PolygonSVGTool.js";

export * from "./viewer/viewer.js";
export * from "./viewer/Scene.js";
export * from "./viewer/HierarchicalSlider.js";

export * from "./modules/OrientedImages/OrientedImages.js";
export * from "./modules/Images360/Images360.js";
export * from "./modules/CameraAnimation/CameraAnimation.js";

export * from "./modules/loader/2.0/OctreeLoader.js";

export {OrbitControls} from "./navigation/OrbitControls.js";
export {FirstPersonControls} from "./navigation/FirstPersonControls.js";
export {EarthControls} from "./navigation/EarthControls.js";
export {DeviceOrientationControls} from "./navigation/DeviceOrientationControls.js";
export {VRControls} from "./navigation/VRControls.js";
// 仅导出 FJD 相机控件 core；Potree 适配器保持内部使用，不对外暴露。
export {FJDCameraControls} from "./FJDCameraControlsHost.js";

import {ensureFJDCameraControlsInstalled} from "./FJDCameraControlsHost.js";
import "./extensions/OrthographicCamera.js";
import "./extensions/PerspectiveCamera.js";
import "./extensions/Ray.js";

import {LRU} from "./LRU.js";
import {OctreeLoader} from "./modules/loader/2.0/OctreeLoader.js";
import {POCLoader} from "./loader/POCLoader.js";
import {CopcLoader, EptLoader} from "./loader/EptLoader.js";
import {PointCloudOctree} from "./PointCloudOctree.js";
import {WorkerPool} from "./WorkerPool.js";

// Potree 模块入口默认把内部 three 注册给 FJD controls，确保直接从 Potree.js 引用时可立即工作。
// Potree 总入口被直接引用时，也要确保独立 controls 包已经完成 THREE 安装。
ensureFJDCameraControlsInstalled();

export const workerPool = new WorkerPool();

export const version = {
	major: 1,
	minor: 8,
	suffix: '.0'
};

export let lru = new LRU();

console.log('Potree ' + version.major + '.' + version.minor + version.suffix);

export let pointBudget = 1 * 1000 * 1000;
export let framenumber = 0;
export let numNodesLoading = 0;
export let maxNodesLoading = 4;

export const debug = {};

let scriptPath = "";

if (document.currentScript && document.currentScript.src) {
	scriptPath = new URL(document.currentScript.src + '/..').href;
	if (scriptPath.slice(-1) === '/') {
		scriptPath = scriptPath.slice(0, -1);
	}
} else if(import.meta){
	scriptPath = new URL(import.meta.url + "/..").href;
	if (scriptPath.slice(-1) === '/') {
		scriptPath = scriptPath.slice(0, -1);
	}
}else {
	console.error('Potree was unable to find its script path using document.currentScript. Is Potree included with a script tag? Does your browser support this function?');
}

let resourcePath = scriptPath + '/resources';

// scriptPath: build/potree
// resourcePath:build/potree/resources
export {scriptPath, resourcePath};

// 统一归一化点云加载错误，避免不同加载器返回的异常形态不一致。
function normalizePointcloudLoadError(path, error){
	if(error instanceof Error){
		return error;
	}

	if(typeof error === "string" && error.length > 0){
		return new Error(error);
	}

	return new Error(`failed to load point cloud from URL: ${path}`);
}

export function loadPointCloud(path, name, callback, getUrl){
	let loaded = function(e){
		e.pointcloud.name = name;
		callback(e);
	};

	let promise = new Promise((resolve, reject) => {
		const resolvePointcloud = (pointcloud) => {
			resolve({type: 'pointcloud_loaded', pointcloud: pointcloud});
		};

		const rejectPointcloud = (error) => {
			reject(normalizePointcloudLoadError(path, error));
		};

		// load pointcloud
		if (!path){
			rejectPointcloud(new Error("point cloud url is empty"));
		} else if (path.includes('ept.json')) {
			EptLoader.load(path, function(geometry) {
				if (!geometry) {
					rejectPointcloud();
				}
				else {
					let pointcloud = new PointCloudOctree(geometry);
					resolvePointcloud(pointcloud);
				}
			}).catch(error => {
				rejectPointcloud(error);
			});
		} else if (path.includes('.copc.laz')) {
			CopcLoader.load(path, function(geometry) {
				if (!geometry) {
					rejectPointcloud();
				}
				else {
					let pointcloud = new PointCloudOctree(geometry);
					resolvePointcloud(pointcloud);
				}
			}).catch(error => {
				rejectPointcloud(error);
			});
		} else if (path.indexOf('cloud.js') > 0) {
			POCLoader.load(path, function (geometry) {
				if (!geometry) {
					rejectPointcloud();
				} else {
					let pointcloud = new PointCloudOctree(geometry);
					resolvePointcloud(pointcloud);
				}
			}).catch(error => {
				rejectPointcloud(error);
			});
		} else if (path.endsWith('metadata.json')) {
			OctreeLoader.load(path, getUrl).then(e => {
				let geometry = e.geometry;

				if(!geometry){
					rejectPointcloud();
				}else{
					let pointcloud = new PointCloudOctree(geometry);

					let aPosition = pointcloud.getAttribute("position");

					// 位置属性缺失时不再抛出二次异常，避免 metadata 成功但回调阶段挂起。
					if(aPosition && aPosition.range){
						let material = pointcloud.material;
						material.elevationRange = [
							aPosition.range[0][2],
							aPosition.range[1][2],
						];
					}

					resolvePointcloud(pointcloud);
				}
			}).catch(error => {
				rejectPointcloud(error);
			});
		} else if (path.indexOf('.vpc') > 0) {
			PointCloudArena4DGeometry.load(path, function (geometry) {
				if (!geometry) {
					rejectPointcloud();
				} else {
					let pointcloud = new PointCloudArena4D(geometry);
					resolvePointcloud(pointcloud);
				}
			});
		} else {
			rejectPointcloud();
		}
	});

	if(callback){
		// 保持旧回调接口可用，同时把异常保留在返回 Promise 上供业务层感知。
		let callbackPromise = promise.then(pointcloud => {
			loaded(pointcloud);
			return pointcloud;
		});

		callbackPromise.catch(error => {
			console.error(error);
		});

		return callbackPromise;
	}

	return promise;
};


// add selectgroup
(function($){
	$.fn.extend({
		selectgroup: function(args = {}){

			let elGroup = $(this);
			let rootID = elGroup.prop("id");
			let groupID = `${rootID}`;
			let groupTitle = (args.title !== undefined) ? args.title : "";

			let elButtons = [];
			elGroup.find("option").each((index, value) => {
				let buttonID = $(value).prop("id");
				let label = $(value).html();
				let optionValue = $(value).prop("value");

				let elButton = $(`
					<span style="flex-grow: 1; display: inherit">
					<label for="${buttonID}" class="ui-button" style="width: 100%; padding: .4em .1em">${label}</label>
					<input type="radio" name="${groupID}" id="${buttonID}" value="${optionValue}" style="display: none"/>
					</span>
				`);
				let elLabel = elButton.find("label");
				let elInput = elButton.find("input");

				elInput.change( () => {
					elGroup.find("label").removeClass("ui-state-active");
					elGroup.find("label").addClass("ui-state-default");
					if(elInput.is(":checked")){
						elLabel.addClass("ui-state-active");
					}else{
						//elLabel.addClass("ui-state-default");
					}
				});

				elButtons.push(elButton);
			});

			let elFieldset = $(`
				<fieldset style="border: none; margin: 0px; padding: 0px">
					<legend>${groupTitle}</legend>
					<span style="display: flex">

					</span>
				</fieldset>
			`);

			let elButtonContainer = elFieldset.find("span");
			for(let elButton of elButtons){
				elButtonContainer.append(elButton);
			}

			elButtonContainer.find("label").each( (index, value) => {
				$(value).css("margin", "0px");
				$(value).css("border-radius", "0px");
				$(value).css("border", "1px solid black");
				$(value).css("border-left", "none");
			});
			elButtonContainer.find("label:first").each( (index, value) => {
				$(value).css("border-radius", "4px 0px 0px 4px");

			});
			elButtonContainer.find("label:last").each( (index, value) => {
				$(value).css("border-radius", "0px 4px 4px 0px");
				$(value).css("border-left", "none");
			});

			elGroup.empty();
			elGroup.append(elFieldset);



		}
	});
})(jQuery);
