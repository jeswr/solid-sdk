// AUTHORED-BY Codex (GPT-6.1 Sol)
import { DataFactory, Store } from "n3";
import {
  ImageGalleryDoc,
  ListItemDoc,
  PhotographDoc,
  RestoreReceipt,
  TrashDoc,
} from "../dist/index.js";

const url = "https://pod.example/a#it";
const dataset = new Store();
const photo = new PhotographDoc(url, dataset, DataFactory);
photo.name = undefined;
photo.description = undefined;
photo.created = undefined;
photo.modified = undefined;
photo.width = undefined;
photo.height = undefined;
photo.exifMake = undefined;
photo.exifOrientation = undefined;
photo.contentUrl = undefined;
photo.geoRef = undefined;
const gallery = new ImageGalleryDoc(url, dataset, DataFactory);
gallery.name = undefined;
gallery.description = undefined;
gallery.dateCreated = undefined;
gallery.coverUrl = undefined;
const item = new ListItemDoc(url, dataset, DataFactory);
item.item = undefined;
item.position = undefined;
const receipt = new RestoreReceipt(url, dataset, DataFactory);
receipt.restoreActivity = undefined;
const trash: RestoreReceipt = new TrashDoc(url, dataset, DataFactory);
trash.restoreActivity = undefined;
const typedTrash = new TrashDoc(url, dataset, DataFactory);
typedTrash.originalUrl = undefined;
typedTrash.actor = undefined;
typedTrash.trashedAt = undefined;
typedTrash.state = undefined;
