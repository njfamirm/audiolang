server/env.ts:5:export type Env = {
server/auth.ts:10:export const SESSION_COOKIE = 'audiolang_session'
server/auth.ts:12:export const SESSION_TTL_SECONDS = 2592000
server/auth.ts:47:export function isAuthRequired(env: Env): boolean {
server/auth.ts:52:export function validatePasscode(env: Env, input: string): boolean {
server/auth.ts:62:export async function signToken(env: Env): Promise<string> {
server/auth.ts:70:export async function verifyToken(env: Env, token: string | undefined): Promise<boolean> {
server/ai.ts:14:export const WORKERS_AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
server/ai.ts:246:export async function explainSentence(
server/ai.ts:260:export async function defineWord(
server/ai.ts:277:export interface GeneratedLessonPack extends AiPack {
server/ai.ts:329:export async function generateLessonPack(
server/ai.ts:342:export async function reviewOutput(
server/index.ts:67:app.get('/api/health', (c) =>
server/index.ts:81:app.post('/api/auth/login', async (c) => {
server/index.ts:101:app.post('/api/auth/logout', (c) => {
server/index.ts:106:app.get('/api/auth/me', async (c) => {
server/index.ts:120:app.get('/api/audio', async (c) => {
server/index.ts:189:app.get('/api/lessons/:id/audio', async (c) => {
server/index.ts:223:app.get('/api/lessons', async (c) => {
server/index.ts:229:app.get('/api/stats', async (c) => {
server/index.ts:234:app.post('/api/lessons/sync', async (c) => {
server/index.ts:250:app.post('/api/lessons/custom', async (c) => {
server/index.ts:284:app.patch('/api/lessons/:id/progress', async (c) => {
server/index.ts:324:app.post('/api/lessons/:id/transcribe', async (c) => {
server/index.ts:410:app.post('/api/lessons/:id/prepare', async (c) => {
server/index.ts:527:app.post('/api/lessons/:id/output-feedback', async (c) => {
server/index.ts:567:app.post('/api/lessons/:id/align', async (c) => {
server/index.ts:618:app.post('/api/lessons/:lessonId/segments/:segmentId/explain', async (c) => {
server/index.ts:642:app.get('/api/vocab', async (c) => {
server/index.ts:647:app.post('/api/vocab', async (c) => {
server/index.ts:664:app.post('/api/vocab/define', async (c) => {
server/index.ts:691:app.post('/api/vocab/:id/review', async (c) => {
server/index.ts:735:app.delete('/api/vocab/:id', async (c) => {
server/index.ts:748:app.get('*', async (c) => {
server/store.ts:11:export interface ExplanationFa {
server/store.ts:20:export interface WarmupItem {
server/store.ts:27:export interface QuizItem {
server/store.ts:35:export interface AiPack {
server/store.ts:42:export interface OutputFeedback {
server/store.ts:48:export interface Segment {
server/store.ts:63:export interface Lesson {
server/store.ts:100:export interface VocabItem {
server/store.ts:117:export interface ActivityLogEntry {
server/store.ts:122:export interface Store {
server/store.ts:128:export const STORE_KEY = 'audiolang_store'
server/store.ts:160:export async function load(env: Env): Promise<Store> {
server/store.ts:175:export async function save(env: Env, store: Store): Promise<void> {
server/store.ts:180:export async function update<T>(
server/store.ts:190:export function findLesson(store: Store, id: string): Lesson | undefined {
server/store.ts:194:export function findVocabById(store: Store, id: string): VocabItem | undefined {
server/store.ts:199:export function todayKey(date = new Date()): string {
server/store.ts:207:export function bumpActivity(
server/store.ts:221:export function findVocab(store: Store, word: string): VocabItem | undefined {
server/store.ts:230:export function upsertVocab(
server/rss.ts:9:export const FEEDS: ReadonlyArray<{ source: string; url: string; sourceLevel: string }> = [
server/rss.ts:60:export function stripHtml(html: string): string {
server/rss.ts:78:export function splitSentences(text: string): string[] {
server/rss.ts:107:export function buildSegments(text: string, max = 40): Segment[] {
server/rss.ts:196:export async function fetchEpisodes(perFeed = 15): Promise<Lesson[]> {
web/src/router.ts:4:export type Route =
web/src/router.ts:10:export function parsePath(path: string): Route {
web/src/router.ts:21:export function navigate(path: string): void {
web/src/router.ts:28:export function useRoutePath(): string {
web/src/types.ts:1:export interface ExplanationFa {
web/src/types.ts:13:export interface WarmupItem {
web/src/types.ts:20:export interface QuizItem {
web/src/types.ts:28:export interface AiPack {
web/src/types.ts:35:export interface OutputFeedback {
web/src/types.ts:42:export interface WordTiming {
web/src/types.ts:48:export interface Segment {
web/src/types.ts:63:export interface Lesson {
web/src/types.ts:100:export interface VocabItem {
web/src/types.ts:117:export interface ActivityLogEntry {
web/src/types.ts:123:export type ActivityLog = Record<string, ActivityLogEntry>
web/src/types.ts:125:export type Mode = 'study' | 'driving'
web/src/types.ts:128:export interface PlayerApi {
server/crypto.ts:4:export function randomUUID(): string {
server/json.ts:5:export function extractJson(content: string): unknown {
server/transcribe.ts:10:export interface WordTiming {
server/transcribe.ts:16:export interface TranscriptSegment {
server/transcribe.ts:24:export interface TranscriptResult {
server/transcribe.ts:51:export const CURRENT_TRANSCRIPT_VERSION = 3
server/transcribe.ts:74:export function transcriptionConfigured(env: Env): boolean {
server/transcribe.ts:230:export function distributeWords(text: string, startSec: number, endSec: number): WordTiming[] {
server/transcribe.ts:370:export function mergeIntoSentences(
server/transcribe.ts:559:export async function transcribeBuffer(
server/transcribe.ts:596:export async function transcribeAudio(
web/src/api.ts:2:export class UnauthorizedError extends Error {
web/src/api.ts:12:export function setUnauthorizedHandler(handler: (() => void) | null): void {
web/src/api.ts:16:export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
