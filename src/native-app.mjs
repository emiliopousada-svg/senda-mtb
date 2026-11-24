import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';

let secureStorageInitialization;

function initializeSecureStorage() {
    if (!secureStorageInitialization) {
        secureStorageInitialization = SecureStorage.setKeyPrefix('senda-mtb')
            .catch(error => {
                secureStorageInitialization = null;
                throw error;
            });
    }
    return secureStorageInitialization;
}

export function isNativePlatform() {
    return Capacitor.isNativePlatform();
}

export async function getSecureItem(key) {
    await initializeSecureStorage();
    return SecureStorage.getItem(key);
}

export async function setSecureItem(key, value) {
    await initializeSecureStorage();
    return SecureStorage.setItem(key, value);
}

export async function removeSecureItem(key) {
    await initializeSecureStorage();
    return SecureStorage.removeItem(key);
}

export function addBackButtonListener(listener) {
    return App.addListener('backButton', listener);
}

export function exitApp() {
    return App.exitApp();
}

export function getAppInfo() {
    return App.getInfo();
}
