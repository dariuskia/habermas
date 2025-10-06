import json
import uuid
from typing import Dict, List, Set, Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from datetime import datetime

app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],  # Add your frontend URLs
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Data models
class Player(BaseModel):
    id: str
    name: str
    response: str = ""
    ranking: List[int] = []  # Ranking of consensus statements
    feedback: str = ""  # Feedback for the winner statement
    likes_winner: Optional[bool] = None  # Whether they like the winner statement (None = not submitted)

class Lobby(BaseModel):
    id: str
    name: str
    host_id: str
    players: List[Player] = []
    max_players: int = 4
    created_at: datetime
    status: str = "in_lobby"  # in_lobby, playing, finished
    prompt: str = ""  # Question/prompt for the game
    game_phase: str = "waiting"  # waiting, respond, rank, feedback
    current_round: int = 1
    consensus_statements: List[str] = []  # K consensus statements
    winner_statement: str = ""  # The winning statement
    all_like_winner: bool = False  # Whether all players like the winner

# In-memory storage (in production, use Redis or database)
lobbies: Dict[str, Lobby] = {}
active_connections: Dict[str, WebSocket] = {}

@app.get("/")
def read_root():
    return {"message": "Habermas Machine API"}

@app.get("/lobbies")
def get_lobbies():
    """Get all active lobbies"""
    return {
        "lobbies": [
            {
                "id": lobby.id,
                "name": lobby.name,
                "player_count": len(lobby.players),
                "max_players": lobby.max_players,
                "status": lobby.status,
                "created_at": lobby.created_at.isoformat(),
                "prompt": lobby.prompt
            }
            for lobby in lobbies.values()
            if lobby.status == "in_lobby"
        ]
    }

class CreateLobbyRequest(BaseModel):
    name: str
    host_name: str
    host_id: str
    max_players: int = 4

@app.post("/lobbies")
def create_lobby(request: CreateLobbyRequest):
    """Create a new lobby"""
    print("created lobby", request.name, request.host_name, request.max_players)
    lobby_id = str(uuid.uuid4())
    host_name = request.host_name
    host_id = request.host_id
    
    lobby = Lobby(
        id=lobby_id,
        name=request.name,
        host_id=host_id,
        max_players=request.max_players,
        created_at=datetime.now()
    )
    
    lobbies[lobby_id] = lobby
    print(host_id)
    return {
        "lobby_id": lobby_id,
        "host_id": host_id,
        "message": "Lobby created successfully"
    }

@app.websocket("/ws/{lobby_id}/{player_id}")
async def websocket_endpoint(websocket: WebSocket, lobby_id: str, player_id: str):
    await websocket.accept()
    active_connections[player_id] = websocket
    
    try:
        # Send current lobby state
        if lobby_id in lobbies:
            lobby = lobbies[lobby_id]
            await websocket.send_text(json.dumps({
                "type": "lobby_state",
                "lobby": {
                    "id": lobby.id,
                    "name": lobby.name,
                    "players": [{"id": p.id, "name": p.name, "response": p.response, "ranking": p.ranking, "feedback": p.feedback, "likes_winner": p.likes_winner} for p in lobby.players],
                    "max_players": lobby.max_players,
                    "status": lobby.status,
                    "host_id": lobby.host_id,
                    "prompt": lobby.prompt,
                    "game_phase": lobby.game_phase,
                    "current_round": lobby.current_round,
                    "consensus_statements": lobby.consensus_statements,
                    "winner_statement": lobby.winner_statement,
                    "all_like_winner": lobby.all_like_winner
                }
            }))
        
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            
            if message["type"] == "join_lobby":
                await handle_join_lobby(lobby_id, player_id, message["player_name"], websocket)
            elif message["type"] == "start_game":
                await handle_start_game(lobby_id, player_id)
            elif message["type"] == "leave_lobby":
                await handle_leave_lobby(lobby_id, player_id)
            elif message["type"] == "update_prompt":
                await handle_update_prompt(lobby_id, player_id, message["prompt"])
            elif message["type"] == "submit_response":
                await handle_submit_response(lobby_id, player_id, message["response"])
            elif message["type"] == "submit_ranking":
                await handle_submit_ranking(lobby_id, player_id, message["ranking"])
            elif message["type"] == "submit_feedback":
                await handle_submit_feedback(lobby_id, player_id, message["likes_winner"], message.get("feedback", ""))
                
    except WebSocketDisconnect:
        await handle_leave_lobby(lobby_id, player_id)
    finally:
        if player_id in active_connections:
            del active_connections[player_id]

async def handle_join_lobby(lobby_id: str, player_id: str, player_name: str, websocket: WebSocket):
    """Handle player joining a lobby"""
    if lobby_id not in lobbies:
        await websocket.send_text(json.dumps({
            "type": "error",
            "message": "Lobby not found"
        }))
        return
    
    lobby = lobbies[lobby_id]
    
    if len(lobby.players) >= lobby.max_players:
        await websocket.send_text(json.dumps({
            "type": "error",
            "message": "Lobby is full"
        }))
        return
    
    # Check if player already exists
    existing_player = next((p for p in lobby.players if p.id == player_id), None)
    if not existing_player:
        player = Player(id=player_id, name=player_name)
        lobby.players.append(player)
    
    # Broadcast updated lobby state to all players
        await broadcast_lobby_update(lobby_id)

async def handle_update_prompt(lobby_id: str, player_id: str, prompt: str):
    """Handle updating the lobby prompt (only host can do this)"""
    if lobby_id not in lobbies:
        return
    
    lobby = lobbies[lobby_id]
    
    if lobby.host_id != player_id:
        return  # Only host can update prompt
    
    lobby.prompt = prompt
    await broadcast_lobby_update(lobby_id)

async def handle_submit_response(lobby_id: str, player_id: str, response: str):
    """Handle player submitting their response"""
    if lobby_id not in lobbies:
        return
    
    lobby = lobbies[lobby_id]
    
    # Find the player and update their response
    for player in lobby.players:
        if player.id == player_id:
            player.response = response
            break
    
    # Check if all players have submitted responses
    all_responses_submitted = all(player.response for player in lobby.players)
    
    if all_responses_submitted and lobby.game_phase == "respond":
        # Generate consensus statements and move to ranking phase
        await generate_consensus_statements(lobby_id)
        lobby.game_phase = "rank"
    
    await broadcast_lobby_update(lobby_id)

async def handle_submit_ranking(lobby_id: str, player_id: str, ranking: List[int]):
    """Handle player submitting their ranking of consensus statements"""
    if lobby_id not in lobbies:
        return
    
    lobby = lobbies[lobby_id]
    
    # Find the player and update their ranking
    for player in lobby.players:
        if player.id == player_id:
            player.ranking = ranking
            break
    
    # Check if all players have submitted rankings
    all_rankings_submitted = all(len(player.ranking) == len(lobby.consensus_statements) for player in lobby.players)
    
    if all_rankings_submitted and lobby.game_phase == "rank":
        # Calculate winner and move to feedback phase
        await calculate_winner_statement(lobby_id)
        lobby.game_phase = "feedback"
    
    await broadcast_lobby_update(lobby_id)

async def handle_submit_feedback(lobby_id: str, player_id: str, likes_winner: bool, feedback: str):
    """Handle player submitting feedback on the winner statement"""
    if lobby_id not in lobbies:
        return
    
    lobby = lobbies[lobby_id]
    
    # Find the player and update their feedback
    for player in lobby.players:
        if player.id == player_id:
            player.likes_winner = likes_winner
            player.feedback = feedback
            break
    
    # Check if all players have submitted feedback
    all_feedback_submitted = all(hasattr(player, 'likes_winner') and player.likes_winner is not None for player in lobby.players)
    
    if all_feedback_submitted and lobby.game_phase == "feedback":
        # Check if all players like the winner
        all_like = all(player.likes_winner for player in lobby.players)
        lobby.all_like_winner = all_like
        
        if all_like:
            # Game is over - all players like the winner
            lobby.status = "finished"
        else:
            # Some players dislike - incorporate feedback and start new round
            lobby.current_round += 1
            await generate_consensus_statements(lobby_id)
            lobby.game_phase = "rank"
            # Reset player states for new round
        for player in lobby.players:
            player.ranking = []
            player.feedback = ""
            player.likes_winner = None
    
    await broadcast_lobby_update(lobby_id)

async def generate_consensus_statements(lobby_id: str):
    """Generate K consensus statements (placeholder implementation)"""
    if lobby_id not in lobbies:
        return
    
    lobby = lobbies[lobby_id]
    
    # Placeholder: Generate 3 consensus statements based on player responses
    # In a real implementation, this would use AI/ML to generate consensus statements
    responses = [player.response for player in lobby.players if player.response]
    
    if responses:
        # Simple placeholder logic - create variations of the responses
        lobby.consensus_statements = [
            f"Consensus Statement 1: {responses[0][:50]}...",
            f"Consensus Statement 2: {responses[-1][:50]}...",
            f"Consensus Statement 3: A balanced approach considering all perspectives"
        ]
    else:
        lobby.consensus_statements = [
            "Consensus Statement 1: Default statement",
            "Consensus Statement 2: Alternative approach", 
            "Consensus Statement 3: Balanced perspective"
        ]

async def calculate_winner_statement(lobby_id: str):
    """Calculate the winning statement based on player rankings"""
    if lobby_id not in lobbies:
        return
    
    lobby = lobbies[lobby_id]
    
    # Simple scoring: sum up rankings (lower rank = higher score)
    statement_scores = [0] * len(lobby.consensus_statements)
    
    for player in lobby.players:
        if len(player.ranking) == len(lobby.consensus_statements):
            for i, rank in enumerate(player.ranking):
                if 0 <= rank < len(statement_scores):
                    statement_scores[rank] += len(lobby.consensus_statements) - i
    
    # Find the statement with the highest score
    if statement_scores:
        winner_index = statement_scores.index(max(statement_scores))
        lobby.winner_statement = lobby.consensus_statements[winner_index]

async def handle_start_game(lobby_id: str, player_id: str):
    """Handle starting the game (only host can do this)"""
    if lobby_id not in lobbies:
        return
    
    lobby = lobbies[lobby_id]
    
    if lobby.host_id != player_id:
        return  # Only host can start
    
    if len(lobby.players) < 2:
        return  # Need at least 2 players
    
    lobby.status = "playing"
    lobby.game_phase = "respond"  # Start with respond phase
    await broadcast_lobby_update(lobby_id)

async def handle_leave_lobby(lobby_id: str, player_id: str):
    """Handle player leaving a lobby"""
    if lobby_id not in lobbies:
        return
    
    lobby = lobbies[lobby_id]
    lobby.players = [p for p in lobby.players if p.id != player_id]
    
    # If no players left, delete lobby
    if not lobby.players:
        del lobbies[lobby_id]
    else:
        # If host left, assign new host
        if lobby.host_id == player_id and lobby.players:
            lobby.host_id = lobby.players[0].id
        
        await broadcast_lobby_update(lobby_id)

async def broadcast_lobby_update(lobby_id: str):
    """Broadcast lobby state to all players in the lobby"""
    if lobby_id not in lobbies:
        return
    
    lobby = lobbies[lobby_id]
    message = json.dumps({
        "type": "lobby_state",
        "lobby": {
            "id": lobby.id,
            "name": lobby.name,
            "players": [{"id": p.id, "name": p.name, "response": p.response, "ranking": p.ranking, "feedback": p.feedback, "likes_winner": p.likes_winner} for p in lobby.players],
            "max_players": lobby.max_players,
            "status": lobby.status,
            "host_id": lobby.host_id,
            "prompt": lobby.prompt,
            "game_phase": lobby.game_phase,
            "current_round": lobby.current_round,
            "consensus_statements": lobby.consensus_statements,
            "winner_statement": lobby.winner_statement,
            "all_like_winner": lobby.all_like_winner
        }
    })
    
    for player in lobby.players:
        if player.id in active_connections:
            try:
                await active_connections[player.id].send_text(message)
            except:
                # Remove disconnected players
                lobby.players = [p for p in lobby.players if p.id != player.id]