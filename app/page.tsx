"use client";

import { useState, useEffect } from "react";

interface Player {
  id: string;
  name: string;
  response?: string;
  ranking?: number[];
  feedback?: string;
  likes_winner?: boolean;
}

interface Lobby {
  id: string;
  name: string;
  players: Player[];
  max_players: number;
  status: string;
  host_id: string;
  prompt: string;
  game_phase: string;
  current_round: number;
  consensus_statements: string[];
  winner_statement: string;
  all_like_winner: boolean;
}

interface LobbySummary {
  id: string;
  name: string;
  player_count: number;
  max_players: number;
  status: string;
  created_at: string;
}

type GameState = "menu" | "create_lobby" | "join_lobby" | "in_lobby" | "playing";

export default function Home() {
  const [gameState, setGameState] = useState<GameState>("menu");
  const [playerName, setPlayerName] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [lobbyName, setLobbyName] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [lobbies, setLobbies] = useState<LobbySummary[]>([]);
  const [currentLobby, setCurrentLobby] = useState<Lobby | null>(null);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [error, setError] = useState("");
  const [promptInput, setPromptInput] = useState("");
  const [responseInput, setResponseInput] = useState("");
  const [rankingInput, setRankingInput] = useState<number[]>([]);
  const [feedbackInput, setFeedbackInput] = useState("");
  const [likesWinner, setLikesWinner] = useState<boolean | null>(null);

  // Generate player ID on component mount
  useEffect(() => {
    setPlayerId(Math.random().toString(36).substr(2, 9));
  }, []);

  // Fetch available lobbies
  const fetchLobbies = async () => {
    try {
      const response = await fetch("http://localhost:8000/lobbies");
      const data = await response.json();
      setLobbies(data.lobbies);
    } catch (err) {
      console.error(err);
      setError("Failed to fetch lobbies");
    }
  };

  // Create a new lobby
  const createLobby = async () => {
    if (!playerName.trim() || !lobbyName.trim()) {
      setError("Please enter both player name and lobby name");
      return;
    }

    try {
      console.log("creating lobby", lobbyName, playerName, maxPlayers);
      const response = await fetch("http://localhost:8000/lobbies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: lobbyName,
          host_name: playerName,
          host_id: playerId,
          max_players: maxPlayers
        })
      });
      
      const data = await response.json();
      console.log("created lobby", data);
      connectToLobby(data.lobby_id, data.host_id);
    } catch (err) {
      setError("Failed to create lobby");
    }
  };

  // Join an existing lobby
  const joinLobby = async (lobbyId: string) => {
    if (!playerName.trim()) {
      setError("Please enter your player name");
      return;
    }
    connectToLobby(lobbyId, playerId);
  };

  // Connect to lobby via WebSocket
  const connectToLobby = (lobbyId: string, pId: string) => {
    const websocket = new WebSocket(`ws://localhost:8000/ws/${lobbyId}/${pId}`);
    
    websocket.onopen = () => {
      setWs(websocket);
      // Send join message
      websocket.send(JSON.stringify({
        type: "join_lobby",
        player_name: playerName
      }));
    };

    websocket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      
      if (message.type === "lobby_state") {
        // Iterate over players and print if each likes the winner
        console.log("lobby status", message.lobby.status);
        console.log("winner statement", message.lobby.winner_statement);
        setCurrentLobby(message.lobby);
        setGameState(message.lobby.status);
      } else if (message.type === "error") {
        setError(message.message);
      }
    };

    websocket.onclose = () => {
      setWs(null);
      setCurrentLobby(null);
      setGameState("menu");
    };

    websocket.onerror = () => {
      setError("Connection error");
    };
  };

  // Update prompt (host only)
  const updatePrompt = () => {
    if (ws && promptInput.trim()) {
      ws.send(JSON.stringify({ 
        type: "update_prompt", 
        prompt: promptInput.trim() 
      }));
      setPromptInput("");
    }
  };

  // Submit response
  const submitResponse = () => {
    if (ws && responseInput.trim()) {
      ws.send(JSON.stringify({ 
        type: "submit_response", 
        response: responseInput.trim() 
      }));
      setResponseInput("");
    }
  };

  // Submit ranking
  const submitRanking = () => {
    if (ws && rankingInput.length === currentLobby?.consensus_statements.length) {
      ws.send(JSON.stringify({ 
        type: "submit_ranking", 
        ranking: rankingInput 
      }));
      setRankingInput([]);
    }
  };

  // Submit feedback
  const submitFeedback = () => {
    if (ws && likesWinner !== null) {
      ws.send(JSON.stringify({ 
        type: "submit_feedback", 
        likes_winner: likesWinner,
        feedback: feedbackInput.trim()
      }));
      setFeedbackInput("");
      setLikesWinner(null);
    }
  };

  // Handle ranking change
  const handleRankingChange = (statementIndex: number, newRank: number) => {
    const newRanking = [...rankingInput];
    newRanking[statementIndex] = newRank;
    setRankingInput(newRanking);
  };

  // Start the game (host only)
  const startGame = () => {
    if (ws && currentLobby) {
      ws.send(JSON.stringify({ type: "start_game" }));
    }
  };

  // Leave the lobby
  const leaveLobby = () => {
    if (ws) {
      ws.send(JSON.stringify({ type: "leave_lobby" }));
      ws.close();
    }
    setGameState("menu");
    setCurrentLobby(null);
  };

  // Load lobbies when joining
  useEffect(() => {
    if (gameState === "join_lobby") {
      fetchLobbies();
    }
  }, [gameState]);

  return (
    <div className="font-sans flex flex-col items-center justify-center min-h-screen gap-4 p-4">
      <h1 className="text-2xl">Habermas Machine</h1>
      
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {gameState === "menu" && (
        <div className="flex flex-col gap-4 items-center">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Your name"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              className="px-3 py-2 border rounded"
            />
          </div>
          <div className="flex gap-2">
            <button 
              onClick={() => setGameState("create_lobby")}
              className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded transition-colors"
            >
              Create Lobby
            </button>
            <button 
              onClick={() => setGameState("join_lobby")}
              className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded transition-colors"
            >
              Join Lobby
            </button>
          </div>
        </div>
      )}

      {gameState === "create_lobby" && (
        <div className="flex flex-col gap-4 items-center">
          <div className="flex flex-col gap-2">
            <input
              type="text"
              placeholder="Lobby name"
              value={lobbyName}
              onChange={(e) => setLobbyName(e.target.value)}
              className="px-3 py-2 border rounded"
            />
            <select
              value={maxPlayers}
              onChange={(e) => setMaxPlayers(Number(e.target.value))}
              className="px-3 py-2 border rounded"
            >
              <option value={2}>2 Players</option>
              <option value={3}>3 Players</option>
              <option value={4}>4 Players</option>
              <option value={6}>6 Players</option>
              <option value={8}>8 Players</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button 
              onClick={createLobby}
              className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded transition-colors"
            >
              Create
            </button>
            <button 
              onClick={() => setGameState("menu")}
              className="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded transition-colors"
            >
              Back
            </button>
          </div>
        </div>
      )}

      {gameState === "join_lobby" && (
        <div className="flex flex-col gap-4 items-center max-w-md">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Your name"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              className="px-3 py-2 border rounded"
            />
            <button 
              onClick={fetchLobbies}
              className="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded transition-colors"
            >
              Refresh
            </button>
          </div>
          
          <div className="w-full">
            <h3 className="text-lg font-semibold mb-2">Available Lobbies</h3>
            {lobbies.length === 0 ? (
              <p className="text-gray-600">No lobbies available</p>
            ) : (
              <div className="space-y-2">
                {lobbies.map((lobby) => (
                  <div key={lobby.id} className="flex justify-between items-center p-3 border rounded">
                    <div>
                      <div className="font-medium">{lobby.name}</div>
                      <div className="text-sm text-gray-600">
                        {lobby.player_count}/{lobby.max_players} players
                      </div>
                    </div>
                    <button
                      onClick={() => joinLobby(lobby.id)}
                      className="bg-green-500 hover:bg-green-600 text-white px-3 py-1 rounded text-sm transition-colors"
                    >
                      Join
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          <button 
            onClick={() => setGameState("menu")}
            className="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded transition-colors"
          >
            Back
          </button>
        </div>
      )}

      {gameState === "in_lobby" && currentLobby && (
        <div className="flex flex-col gap-4 items-center max-w-md">
          <h2 className="text-xl font-semibold">{currentLobby.name}</h2>
          
          {/* Current Prompt Display */}
          {currentLobby.prompt && (
            <div className="w-full p-3 bg-blue-50 border border-blue-200 rounded">
              <h4 className="font-medium text-blue-800 mb-1">Current Question:</h4>
              <p className="text-blue-700">{currentLobby.prompt}</p>
            </div>
          )}
          
          {/* Host Prompt Input */}
          {currentLobby.host_id === playerId && (
            <div className="w-full">
              <h3 className="text-lg font-semibold mb-2">Set Game Question</h3>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Enter your question or prompt..."
                  value={promptInput}
                  onChange={(e) => setPromptInput(e.target.value)}
                  className="flex-1 px-3 py-2 border rounded"
                  onKeyPress={(e) => e.key === 'Enter' && updatePrompt()}
                />
                <button
                  onClick={updatePrompt}
                  className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded transition-colors"
                >
                  Set
                </button>
              </div>
            </div>
          )}
          
          <div className="w-full">
            <h3 className="text-lg font-semibold mb-2">Players ({currentLobby.players.length}/{currentLobby.max_players})</h3>
            <div className="space-y-2">
              {currentLobby.players.map((player) => (
                <div key={player.id} className="flex justify-between items-center p-2 border rounded">
                  <span className={player.id === playerId ? "font-bold" : ""}>
                    {player.name} {player.id === currentLobby.host_id && "(Host)"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            {currentLobby.host_id === playerId && currentLobby.players.length >= 2 && (
              <button
                onClick={startGame}
                className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded transition-colors"
              >
                Start Game
              </button>
            )}
            <button
              onClick={leaveLobby}
              className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded transition-colors"
            >
              Leave Lobby
            </button>
          </div>
        </div>
      )}

      {gameState === "playing" && currentLobby && (
        <div className="flex flex-col gap-4 items-center max-w-4xl">
          <div className="flex items-center gap-4">
            <h2 className="text-xl font-semibold">Round {currentLobby.current_round}</h2>
            <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm font-medium">
              {currentLobby.game_phase.charAt(0).toUpperCase() + currentLobby.game_phase.slice(1)} Phase
            </span>
          </div>
          
          {/* Display the game question/prompt */}
          {currentLobby.prompt && (
            <div className="w-full p-6 bg-yellow-50 border-2 border-yellow-300 rounded-lg">
              <h3 className="text-lg font-bold text-yellow-800 mb-3">Game Question:</h3>
              <p className="text-lg text-yellow-700 text-center">{currentLobby.prompt}</p>
            </div>
          )}
          
          {/* Respond Phase */}
          {currentLobby.game_phase === "respond" && (
            <div className="w-full space-y-4">
              {/* Show response progress */}
              <div className="w-full p-4 bg-blue-50 border border-blue-200 rounded">
                <h4 className="font-semibold text-blue-800 mb-2">Response Progress</h4>
                <p className="text-blue-700">
                  {currentLobby.players.filter(p => p.response).length} of {currentLobby.players.length} responses submitted
                </p>
                <div className="w-full bg-blue-200 rounded-full h-2 mt-2">
                  <div 
                    className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                    style={{ 
                      width: `${(currentLobby.players.filter(p => p.response).length / currentLobby.players.length) * 100}%` 
                    }}
                  ></div>
                </div>
              </div>
              
              {/* Response submission form */}
              <div className="w-full p-4 bg-gray-50 border rounded">
                <h4 className="font-semibold mb-2">Your Response:</h4>
                <div className="flex gap-2">
                  <textarea
                    placeholder="Enter your response to the question..."
                    value={responseInput}
                    onChange={(e) => setResponseInput(e.target.value)}
                    className="flex-1 px-3 py-2 border rounded resize-none"
                    rows={3}
                  />
                  <button
                    onClick={submitResponse}
                    disabled={!responseInput.trim()}
                    className="bg-green-500 hover:bg-green-600 disabled:bg-gray-300 text-white px-4 py-2 rounded transition-colors"
                  >
                    Submit
                  </button>
                </div>
                {currentLobby.players.find(p => p.id === playerId)?.response && (
                  <p className="text-sm text-green-600 mt-2">✓ Response submitted!</p>
                )}
              </div>
            </div>
          )}
          
          {/* Rank Phase */}
          {currentLobby.game_phase === "rank" && (
            <div className="w-full space-y-4">
              {/* Show ranking progress */}
              <div className="w-full p-4 bg-purple-50 border border-purple-200 rounded">
                <h4 className="font-semibold text-purple-800 mb-2">Ranking Progress</h4>
                <p className="text-purple-700">
                  {currentLobby.players.filter(p => p.ranking && p.ranking.length === currentLobby.consensus_statements.length).length} of {currentLobby.players.length} rankings submitted
                </p>
                <div className="w-full bg-purple-200 rounded-full h-2 mt-2">
                  <div 
                    className="bg-purple-600 h-2 rounded-full transition-all duration-300"
                    style={{ 
                      width: `${(currentLobby.players.filter(p => p.ranking && p.ranking.length === currentLobby.consensus_statements.length).length / currentLobby.players.length) * 100}%` 
                    }}
                  ></div>
                </div>
              </div>
              
              {/* Consensus statements for ranking */}
              <div className="w-full p-4 bg-gray-50 border rounded">
                <h4 className="font-semibold mb-3">Rank the Consensus Statements (1 = best, 3 = worst):</h4>
                <div className="space-y-3">
                  {currentLobby.consensus_statements.map((statement, index) => (
                    <div key={index} className="flex items-center gap-3 p-3 bg-white border rounded">
                      <div className="flex-1">
                        <p className="text-sm text-gray-600 mb-1">Statement {index + 1}:</p>
                        <p className="font-medium">{statement}</p>
                      </div>
                      <select
                        value={rankingInput[index] || ""}
                        onChange={(e) => handleRankingChange(index, parseInt(e.target.value))}
                        className="px-3 py-2 border rounded"
                      >
                        <option value="">Select rank</option>
                        <option value="1">1 (Best)</option>
                        <option value="2">2</option>
                        <option value="3">3 (Worst)</option>
                      </select>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex justify-end">
                  <button
                    onClick={submitRanking}
                    disabled={rankingInput.length !== currentLobby.consensus_statements.length || rankingInput.some(rank => !rank)}
                    className="bg-purple-500 hover:bg-purple-600 disabled:bg-gray-300 text-white px-6 py-2 rounded transition-colors"
                  >
                    Submit Ranking
                  </button>
                </div>
                {currentLobby.players.find(p => p.id === playerId)?.ranking && currentLobby.players.find(p => p.id === playerId)?.ranking?.length === currentLobby.consensus_statements.length && (
                  <p className="text-sm text-green-600 mt-2">✓ Ranking submitted!</p>
                )}
              </div>
            </div>
          )}
          
          {/* Feedback Phase */}
          {currentLobby.game_phase === "feedback" && (
            <div className="w-full space-y-4">
              {/* Show feedback progress */}
              <div className="w-full p-4 bg-orange-50 border border-orange-200 rounded">
                <h4 className="font-semibold text-orange-800 mb-2">Feedback Progress</h4>
                <p className="text-orange-700">
                  {currentLobby.players.filter(p => p.likes_winner !== null).length} of {currentLobby.players.length} feedback submitted
                </p>
                <div className="w-full bg-orange-200 rounded-full h-2 mt-2">
                  <div 
                    className="bg-orange-600 h-2 rounded-full transition-all duration-300"
                    style={{ 
                      width: `${(currentLobby.players.filter(p => p.likes_winner !== null).length / currentLobby.players.length) * 100}%` 
                    }}
                  ></div>
                </div>
              </div>
              
              {/* Winner statement */}
              <div className="w-full p-4 bg-green-50 border border-green-200 rounded">
                <h4 className="font-semibold text-green-800 mb-2">Winner Statement:</h4>
                <p className="text-green-700 text-lg">{currentLobby.winner_statement}</p>
              </div>
              
              {/* Feedback form */}
              <div className="w-full p-4 bg-gray-50 border rounded">
                <h4 className="font-semibold mb-3">Do you like this statement?</h4>
                <div className="flex gap-4 mb-4">
                  <button
                    onClick={() => setLikesWinner(true)}
                    className={`px-6 py-2 rounded transition-colors ${
                      likesWinner === true 
                        ? 'bg-green-500 text-white' 
                        : 'bg-gray-200 text-gray-700 hover:bg-green-100'
                    }`}
                  >
                    👍 Like
                  </button>
                  <button
                    onClick={() => setLikesWinner(false)}
                    className={`px-6 py-2 rounded transition-colors ${
                      likesWinner === false 
                        ? 'bg-red-500 text-white' 
                        : 'bg-gray-200 text-gray-700 hover:bg-red-100'
                    }`}
                  >
                    👎 Dislike
                  </button>
                </div>
                
                {likesWinner === false && (
                  <div className="mt-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Please provide feedback to improve the statement:
                    </label>
                    <textarea
                      placeholder="What would you like to change or improve?"
                      value={feedbackInput}
                      onChange={(e) => setFeedbackInput(e.target.value)}
                      className="w-full px-3 py-2 border rounded resize-none"
                      rows={3}
                    />
                  </div>
                )}
                
                <div className="mt-4 flex justify-end">
                  <button
                    onClick={submitFeedback}
                    disabled={likesWinner === null}
                    className="bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 text-white px-6 py-2 rounded transition-colors"
                  >
                    Submit Feedback
                  </button>
                </div>
                {currentLobby.players.find(p => p.id === playerId)?.likes_winner !== undefined && (
                  <p className="text-sm text-green-600 mt-2">✓ Feedback submitted!</p>
                )}
              </div>
            </div>
          )}
          
          <button
            onClick={leaveLobby}
            className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded transition-colors"
          >
            Leave Game
          </button>
        </div>
      )}
      
      {/* Game Finished */}
      {gameState == "finished" && currentLobby && (
        <div className="w-full p-6 bg-green-50 border-2 border-green-300 rounded-lg text-center">
          <h3 className="text-xl font-bold text-green-800 mb-2">🎉 Game Complete!</h3>
          <p className="text-green-700">All players agreed on the final statement!</p>
          <div className="mt-4 p-4 bg-white border rounded">
            <p className="text-gray-600 mt-2">{currentLobby.winner_statement}</p>
          </div>
          <button
            onClick={() => setGameState("in_lobby")}
            className="mt-6 bg-blue-500 hover:bg-blue-600 text-white px-6 py-2 rounded transition-colors"
          >
            Return to Lobby
          </button>
        </div>
      )}
          
    </div>
  );
}
